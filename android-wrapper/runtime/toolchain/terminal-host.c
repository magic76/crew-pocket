/* Crew Pocket PTY host. stdin: [uint32 BE length][type + payload]. stdout: PTY bytes. */
#include <pty.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/wait.h>

static volatile sig_atomic_t stopping;
static void stop(int signal_number) { (void)signal_number; stopping = 1; }
static int write_all(int fd, const void *buffer, size_t length) {
    const char *p = buffer;
    while (length) {
        ssize_t n = write(fd, p, length);
        if (n < 0 && errno == EINTR && !stopping) continue;
        if (n <= 0) return -1;
        p += n; length -= n;
    }
    return 0;
}
int main(int argc, char **argv) {
    if (argc != 2) return 64;
    pid_t parent = getppid();
    prctl(PR_SET_PDEATHSIG, SIGTERM);
    if (getppid() != parent) return 1;
    struct sigaction action = { .sa_handler = stop };
    sigaction(SIGTERM, &action, NULL); sigaction(SIGHUP, &action, NULL);
    signal(SIGPIPE, SIG_IGN);
    int master;
    struct winsize size = { .ws_row = 24, .ws_col = 80 };
    pid_t shell = forkpty(&master, NULL, NULL, &size);
    if (shell < 0) { perror("forkpty"); return 1; }
    if (!shell) {
        signal(SIGTERM, SIG_DFL); signal(SIGHUP, SIG_DFL); signal(SIGPIPE, SIG_DFL);
        prctl(PR_SET_PDEATHSIG, SIGHUP);
        execl(argv[1], "bash", "--noprofile", "--norc", "-i", (char *)NULL);
        perror("exec shell"); _exit(127);
    }
    unsigned char input[65540], output[8192]; size_t used = 0;
    while (!stopping) {
        struct pollfd fds[] = {{STDIN_FILENO, POLLIN, 0}, {master, POLLIN, 0}};
        int ready = poll(fds, 2, -1);
        if (ready < 0) { if (errno == EINTR) continue; break; }
        if (fds[1].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t n = read(master, output, sizeof(output));
            if (n <= 0 || write_all(STDOUT_FILENO, output, n)) break;
        }
        if (fds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t n = read(STDIN_FILENO, input + used, sizeof(input) - used);
            if (n <= 0) break;
            used += n;
            while (used >= 4) {
                uint32_t length = ((uint32_t)input[0]<<24) | ((uint32_t)input[1]<<16) | ((uint32_t)input[2]<<8) | input[3];
                if (!length || length > 65536) { stopping = 1; break; }
                if (used < length + 4) break;
                if (input[4] == 'I') {
                    if (write_all(master, input + 5, length - 1)) { stopping = 1; break; }
                } else if (input[4] == 'R' && length == 5) {
                    size.ws_row = (input[5]<<8) | input[6]; size.ws_col = (input[7]<<8) | input[8];
                    ioctl(master, TIOCSWINSZ, &size);
                }
                used -= length + 4; memmove(input, input + length + 4, used);
            }
        }
    }
    pid_t foreground = tcgetpgrp(master);
    if (foreground > 0) kill(-foreground, SIGHUP);
    kill(-shell, SIGHUP); close(master);
    int status = 0;
    for (int i = 0; i < 20; i++) {
        pid_t result = waitpid(shell, &status, WNOHANG);
        if (result == shell || (result < 0 && errno == ECHILD)) goto done;
        usleep(50000);
    }
    if (foreground > 0) kill(-foreground, SIGKILL);
    kill(-shell, SIGKILL); waitpid(shell, &status, 0);
done:
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
