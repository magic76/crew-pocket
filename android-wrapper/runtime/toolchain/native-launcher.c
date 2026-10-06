/* Installer-owned dispatcher for tools whose resources live in private assets. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>

int main(int argc, char **argv) {
    const char *root = getenv("CREW_TOOL_ROOT"), *native = getenv("CREW_NATIVE_DIR");
    const char *name = strrchr(argv[0], '/'); name = name ? name + 1 : argv[0];
    if (!root || !native) return 126;
    char table[PATH_MAX], line[PATH_MAX * 2];
    snprintf(table, sizeof table, "%s/native-launchers.tsv", root);
    FILE *file = fopen(table, "r");
    if (!file) { perror(table); return 126; }
    while (fgets(line, sizeof line, file)) {
        char *save = NULL, *command = strtok_r(line, "\t", &save);
        char *library = strtok_r(NULL, "\t", &save), *relative = strtok_r(NULL, "\t", &save);
        char *kind = strtok_r(NULL, "\n", &save);
        if (!command || !library || !relative || !kind || strcmp(command, name)) continue;
        char binary[PATH_MAX], logical[PATH_MAX], preload[PATH_MAX];
        snprintf(binary, sizeof binary, "%s/%s", native, library);
        snprintf(logical, sizeof logical, "%s/%s", root, relative);
        char **args = calloc((size_t)argc + 3, sizeof(char *));
        if (!args) { fclose(file); return 126; }
        args[0] = logical;
        int offset = 1;
        if (!strcmp(kind, "clang")) {
            // The static Clang driver cannot use LD_PRELOAD. Keep its logical
            // argv[0] directory for resource headers and sibling linker lookup.
            args[offset++] = "-no-canonical-prefixes";
            if (!strcmp(name, "clang++")) args[offset++] = "--driver-mode=g++";
        } else {
            snprintf(preload, sizeof preload, "%s/libcrew_native_paths.so", native);
            setenv("LD_PRELOAD", preload, 1);
            setenv("CREW_TOOL_LOGICAL_EXEC", logical, 1);
            setenv("CREW_TOOL_NATIVE_EXEC", binary, 1);
        }
        for (int i = 1; i < argc; i++) args[offset++] = argv[i];
        fclose(file); execv(binary, args); perror(binary); return 126;
    }
    fclose(file); fprintf(stderr, "%s: native launcher mapping missing\n", name); return 127;
}
