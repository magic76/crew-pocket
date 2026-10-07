#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>

ssize_t readlink(const char *path, char *buffer, size_t length) {
    static ssize_t (*original)(const char *, char *, size_t);
    if (!original) original = dlsym(RTLD_NEXT, "readlink");
    const char *logical = getenv("CREW_TOOL_LOGICAL_EXEC");
    const char *native = getenv("CREW_TOOL_NATIVE_EXEC");
    char actual[PATH_MAX];
    ssize_t count;
    if (logical && native && !strcmp(path, "/proc/self/exe") &&
        (count = original(path, actual, sizeof actual - 1)) > 0) {
        actual[count] = '\0';
        if (!strcmp(actual, native)) {
            size_t n = strlen(logical); if (n > length) n = length;
            memcpy(buffer, logical, n); return n;
        }
    }
    return original(path, buffer, length);
}

char *realpath(const char *path, char *resolved) {
    static char *(*original)(const char *, char *);
    if (!original) original = dlsym(RTLD_NEXT, "realpath");
    char *result = original(path, resolved);
    const char *logical = getenv("CREW_TOOL_LOGICAL_EXEC");
    const char *native = getenv("CREW_TOOL_NATIVE_EXEC");
    // argv[0] can point to our dispatcher symlink rather than the real tool.
    if (result && logical && native && (!strcmp(path, logical) || !strcmp(result, native))) {
        if (!resolved) { free(result); return strdup(logical); }
        if (strlen(logical) < PATH_MAX) strcpy(resolved, logical);
    }
    return result;
}
