#include <stdio.h>
int main(int argc, char **argv) {
    (void)argc;
    fprintf(stderr, "Unsupported optional Android SDK operation: %s. Runtime supports APK builds, not this legacy inspection command.\n", argv[0]);
    return 127;
}
