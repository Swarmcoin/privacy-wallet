#!/bin/bash
# Undoes what swarm-deb-postinstall.sh put outside /opt.
#
# A template, like the postinstall: electron-builder fills in this build's
# executable name when it packages the .deb, so the files removed are the
# ones this package installed and never the other SWARM Wallet package's.
#
# Nothing here touches the user's wallet: that lives in their home directory
# and removing the application must never remove their coins.

BINARY='/opt/${sanitizedProductName}/${executable}'
NAME="$(printf '%s' '${executable}' | tr ' ' '-' | tr '[:upper:]' '[:lower:]')"

rm -f '/usr/share/polkit-1/actions/green.swarm.wallet.policy'

# Only our own symlink, never one a user made themselves pointing elsewhere.
LINK="$(readlink "/usr/bin/$NAME" 2>/dev/null || true)"
if [ -L "/usr/bin/$NAME" ] && [ "$LINK" = "$BINARY" ]; then
    rm -f "/usr/bin/$NAME"
fi

APPARMOR_DST="/etc/apparmor.d/$NAME"
if [ -f "$APPARMOR_DST" ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -R "$APPARMOR_DST" 2>/dev/null || true
    fi
    rm -f "$APPARMOR_DST"
fi
