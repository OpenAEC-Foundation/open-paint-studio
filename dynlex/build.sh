#!/usr/bin/env bash
# Builds and tests the native DynLex edition of OpenAEC Paint Studio.
#
#   dynlex/build.sh app            optimised editor (dynlex/build/open-paint-studio)
#   dynlex/build.sh dev            unoptimised editor
#   dynlex/build.sh test [NAME...] headless tests in dynlex/tests (all when no name)
#   dynlex/build.sh run [IMAGE]    build and run the editor
#
# The compiler is the DynLex checkout named by DYNLEX_ROOT (built in place at
# build/dynlex). Everything compiles and runs from the repository root, where
# the imports (dynlex/paint/...) and the tests' file paths resolve.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
root=${DYNLEX_ROOT:-$HOME/dynlex}
dynlex="$root/build/dynlex"
[[ -x $dynlex ]] || { echo "No compiler at $dynlex; set DYNLEX_ROOT." >&2; exit 1; }
mkdir -p dynlex/build
case ${1:-app} in
    app) "$dynlex" dynlex/paint/main.dl -O2 -o dynlex/build/open-paint-studio ;;
    dev) "$dynlex" dynlex/paint/main.dl -O0 -g -o dynlex/build/open-paint-studio-dev ;;
    run) "$dynlex" dynlex/paint/main.dl -O2 -o dynlex/build/open-paint-studio
         shift; exec dynlex/build/open-paint-studio "$@" ;;
    test)
        shift
        names=("$@")
        if [[ ${#names[@]} -eq 0 ]]; then
            for file in dynlex/tests/*.dl; do names+=("$(basename "$file" .dl)"); done
        fi
        status=0
        for name in "${names[@]}"; do
            if ! output=$("$dynlex" "dynlex/tests/$name.dl" -O0 -o "dynlex/build/test-$name" 2>&1) || [[ -n $output ]]; then
                echo "DIAG $name"; echo "$output" | head -20; status=1; continue
            fi
            if "dynlex/build/test-$name" | diff -u "dynlex/tests/$name.expected.txt" - > "dynlex/build/test-$name.diff"; then
                echo "PASS $name"
            else
                echo "FAIL $name"; head -20 "dynlex/build/test-$name.diff"; status=1
            fi
        done
        exit $status ;;
    *) sed -n 2,9p "$0"; exit 2 ;;
esac
