/* Start relocated JDK tools from installer-owned ELF files. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
int main(int argc, char **argv) {
    (void)argc;
    const char *root = getenv("CREW_TOOL_ROOT"), *native = getenv("CREW_NATIVE_DIR"), *home = getenv("JAVA_HOME");
    const char *name = strrchr(argv[0], '/'); name = name ? name + 1 : argv[0];
    if (!root || !native || !home) return 126;
    char file[PATH_MAX], line[PATH_MAX], binary[PATH_MAX], shim[PATH_MAX], logical[PATH_MAX];
    snprintf(file, sizeof(file), "%s/java-native.tsv", root);
    FILE *map = fopen(file, "r"); if (!map) { perror(file); return 126; }
    binary[0] = 0;
    while (fgets(line, sizeof(line), map)) {
        char *save = NULL, *tool = strtok_r(line, "\t", &save), *library = strtok_r(NULL, "\n", &save);
        if (!tool || !library) continue;
        if (!strcmp(tool, name)) snprintf(binary, sizeof(binary), "%s/%s", native, library);
        if (!strcmp(tool, "jvm")) setenv("CREW_JVM_LIBRARY", library, 1);
    }
    fclose(map); if (!binary[0]) return 127;
    snprintf(shim, sizeof(shim), "%s/libcrew_java_paths.so", native);
    snprintf(logical, sizeof(logical), "%s/bin/%s", home, name);
    setenv("LD_PRELOAD", shim, 1); setenv("CREW_JAVA_LOGICAL_EXEC", logical, 1);
    argv[0] = logical;
    execv(binary, argv); perror(binary); return 126;
}
