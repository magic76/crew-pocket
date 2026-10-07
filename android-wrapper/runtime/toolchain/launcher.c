/* App-private scripts are data. This installer-owned ELF dispatches them through
 * an installer-owned interpreter without relying on an executable shebang. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
int main(int argc, char **argv) {
    const char *root = getenv("CREW_TOOL_ROOT"), *native = getenv("CREW_NATIVE_DIR");
    const char *name = strrchr(argv[0], '/'); name = name ? name + 1 : argv[0];
    if (!root || !native) { fprintf(stderr, "%s: runtime tool environment missing\n", name); return 126; }
    char path[PATH_MAX], line[PATH_MAX * 2];
    snprintf(path, sizeof path, "%s/launchers.tsv", root);
    FILE *f = fopen(path, "r");
    if (!f) { perror(path); return 126; }
    while (fgets(line, sizeof line, f)) {
        char *save = NULL;
        char *command = strtok_r(line, "\t", &save), *interpreter = strtok_r(NULL, "\t", &save), *script = strtok_r(NULL, "\n", &save);
        if (!command || !interpreter || !script || strcmp(command, name)) continue;
        char binary[PATH_MAX], entry[PATH_MAX];
        snprintf(binary, sizeof binary, "%s/%s", native, interpreter);
        snprintf(entry, sizeof entry, "%s/%s", root, script);
        char **args = calloc((size_t)argc + 2, sizeof(char *));
        if (!args) { fclose(f); return 126; }
        args[0] = binary; args[1] = entry;
        for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
        fclose(f); execv(binary, args); int error = errno; perror(binary); return error == ENOENT ? 127 : 126;
    }
    fclose(f); fprintf(stderr, "%s: no packaged launcher\n", name); return 127;
}
