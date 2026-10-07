#!/bin/sh
# Bumps the ?v= cache-buster on the stylesheet and on every module import,
# so browsers (and GitHub Pages' 10-minute cache) never mix old and new
# modules. Run it before pushing changes to css/ or js/.
cd "$(dirname "$0")/.." || exit 1
old=$(grep -o 'app\.js?v=[0-9]*' index.html | head -1 | sed 's/.*=//')
new=$((old + 1))
perl -pi -e "s/\.(js|css)\?v=\d+/.\$1?v=$new/g" index.html js/*.js
echo "cache-buster v=$old -> v=$new"
