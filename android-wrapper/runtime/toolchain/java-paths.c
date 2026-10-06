/* JDK locates its image from executable/libjvm locations. Android stores native
 * files in a flat installer directory; expose the private logical JDK layout.
 * Preloaded only by the Java launcher, never by the Node server. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <stdio.h>
ssize_t readlink(const char *path, char *buffer, size_t length) {
    static ssize_t (*original)(const char *, char *, size_t);
    if (!original) original = dlsym(RTLD_NEXT, "readlink");
    const char *logical = getenv("CREW_JAVA_LOGICAL_EXEC");
    if (logical && !strcmp(path, "/proc/self/exe")) {
        size_t n = strlen(logical); if (n > length) n = length; memcpy(buffer, logical, n); return n;
    }
    return original(path, buffer, length);
}
int dladdr(const void *address, Dl_info *info) {
    static int (*original)(const void *, Dl_info *);
    static _Thread_local char logical[PATH_MAX];
    if (!original) original = dlsym(RTLD_NEXT, "dladdr");
    int result = original(address, info);
    const char *library = getenv("CREW_JVM_LIBRARY"), *home = getenv("JAVA_HOME");
    if (result && info->dli_fname && library && home && strstr(info->dli_fname, library)) {
        snprintf(logical, sizeof(logical), "%s/lib/server/libjvm.so", home); info->dli_fname = logical;
    }
    return result;
}
