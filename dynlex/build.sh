#!/usr/bin/env bash
# Builds and tests Open Paint Studio, the native DynLex edition of OpenAEC
# Paint Studio.
#
#   dynlex/build.sh codecs         the codec library dynlex/build/libpaintcodecs.a
#                                  (run first by every command; rebuilt only
#                                  when a decoder's source changed)
#   dynlex/build.sh app            optimised editor (dynlex/build/open-paint-studio)
#   dynlex/build.sh dev            unoptimised editor
#   dynlex/build.sh test [NAME...] headless tests in dynlex/tests (all when no name)
#   dynlex/build.sh run [IMAGE]    build and run the editor
#   dynlex/build.sh bench          time the pixel work on a 1920 × 1080 canvas
#   dynlex/build.sh install        build, and add Open Paint Studio with its icon
#                                  to the desktop's applications (~/.local/share)
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

# The raster codecs (dynlex/paint/codecs.dl and what it imports) compile on
# their own into a definition-only object, archived as libpaintcodecs.a; the
# editor, the tests and the benchmarks link it by the name "paintcodecs"
# through LIBRARY_PATH, so a change to the interface leaves them alone.
codec_sources=(codecs decoded canvas jpeg png formats webp vp8 vp8_tables inflate ifcimage jpeg2000 avif av1 av1_filter av1_block av1_predict av1_tables av1_transforms)
archive=dynlex/build/libpaintcodecs.a
build_codecs() {
    local stale=0 name
    [[ -f $archive ]] || stale=1
    for name in "${codec_sources[@]}"; do
        [[ dynlex/paint/$name.dl -nt $archive ]] && stale=1
    done
    [[ $root/build/dynlex -nt $archive ]] && stale=1
    (( stale )) || return 0
    if ! "$dynlex" dynlex/paint/codecs.dl --emit-object --no-main -O2 -o dynlex/build/paintcodecs.o > dynlex/build/paintcodecs.diag 2>&1 || [[ -s dynlex/build/paintcodecs.diag ]]; then
        echo "codec library DIAG"; head -20 dynlex/build/paintcodecs.diag; exit 1
    fi
    rm -f "$archive"
    ar rcs "$archive" dynlex/build/paintcodecs.o
    echo "Built $archive"
}
build_codecs
export LIBRARY_PATH="$here/dynlex/build${LIBRARY_PATH:+:$LIBRARY_PATH}"
case ${1:-app} in
    codecs) ;;
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
    bench) "$dynlex" dynlex/bench/canvas.dl -O2 -o dynlex/build/bench-canvas && dynlex/build/bench-canvas ;;
    install)
        "$dynlex" dynlex/paint/main.dl -O2 -o dynlex/build/open-paint-studio
        share=${XDG_DATA_HOME:-$HOME/.local/share}
        mkdir -p "$share/applications" "$share/icons/hicolor/scalable/apps"
        cp dynlex/assets/icon/open-paint-studio.svg "$share/icons/hicolor/scalable/apps/open-paint-studio.svg"
        for size in 16 32 64 128 256 512; do
            mkdir -p "$share/icons/hicolor/${size}x${size}/apps"
            cp "dynlex/assets/icon/open-paint-studio-$size.png" "$share/icons/hicolor/${size}x${size}/apps/open-paint-studio.png"
        done
        command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t -f "$share/icons/hicolor" || true
        sed "s|@EXEC@|$here/dynlex/build/open-paint-studio|" dynlex/assets/open-paint-studio.desktop > "$share/applications/open-paint-studio.desktop"
        command -v update-desktop-database >/dev/null && update-desktop-database "$share/applications" || true
        echo "Installed $share/applications/open-paint-studio.desktop" ;;
    *) sed -n 2,12p "$0"; exit 2 ;;
esac
