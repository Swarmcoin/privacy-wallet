#!/bin/bash
# Runs after `dpkg -i` of the SWARM Wallet .deb.
#
# A template: electron-builder replaces the two macros written with a dollar
# sign and braces when it packages the .deb (FpmTarget writeConfigFile), so
# every path below is the path of the build being installed: /opt/SWARM Wallet
# and its SWARM Wallet binary for mainnet, /opt/SWARM Wallet (Testnet) and its
# SWARM Wallet Testnet binary for testnet. Up to 0.1.0-mainnet.7 this script
# probed for either directory and copied a profile that named the testnet's
# binary, so the mainnet wallet got an AppArmor profile that matched nothing.
# scripts/check-swarm-deb.js holds the built package to these paths in CI.
#
# Nothing else in here may be written with braces around letters only: the
# packager would take it for a macro.
set -e

APP_DIR='/opt/${sanitizedProductName}'
BINARY='/opt/${sanitizedProductName}/${executable}'
CHROME_SANDBOX='/opt/${sanitizedProductName}/chrome-sandbox'
APPARMOR_SRC='/opt/${sanitizedProductName}/resources/apparmor-profile'
POLICY_SRC='/opt/${sanitizedProductName}/resources/green.swarm.wallet.policy'
POLICY_DST='/usr/share/polkit-1/actions/green.swarm.wallet.policy'

# The name of what this package puts outside /opt: swarm-wallet for the
# mainnet wallet, swarm-wallet-testnet for the testnet one, so the two can be
# installed side by side without one overwriting the other's profile or link.
NAME="$(printf '%s' '${executable}' | tr ' ' '-' | tr '[:upper:]' '[:lower:]')"
APPARMOR_DST="/etc/apparmor.d/$NAME"

[ -d "$APP_DIR" ] || exit 0

# 1. Chromium's setuid sandbox helper. Ubuntu 22.04+ and Debian 11+ restrict
#    unprivileged user namespaces, and without this the renderer cannot start.
if [ -f "$CHROME_SANDBOX" ]; then
    chown root "$CHROME_SANDBOX"
    chmod 4755 "$CHROME_SANDBOX"
fi

# 2. AppArmor profile, for 24.04+ where the sysctl above is replaced by an
#    AppArmor restriction and the SUID helper alone is not enough. The file is
#    the one electron-builder generated for this build's own binary.
if [ -f "$APPARMOR_SRC" ] && [ -d /etc/apparmor.d ]; then
    cp "$APPARMOR_SRC" "$APPARMOR_DST"
    chmod 644 "$APPARMOR_DST"
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -r "$APPARMOR_DST" 2>/dev/null || true
    fi
fi

# 3. The polkit action behind device authentication. Without it the wallet
#    finds no action registered and skips the unlock screen rather than
#    offering a button that cannot work.
if [ -f "$POLICY_SRC" ]; then
    cp "$POLICY_SRC" "$POLICY_DST"
    chmod 644 "$POLICY_DST"
fi

# 4. A name on the PATH. electron installs under a directory with spaces,
#    which is not somewhere anyone wants to type.
if [ -f "$BINARY" ] && [ -d /usr/bin ]; then
    ln -sf "$BINARY" "/usr/bin/$NAME"
fi

# Upstream additionally rewrites the .desktop Exec line to route through a
# wrapper that forwards `zcash:` payment links. This build deliberately
# registers no such handler — it is not a wallet for the public Zcash network
# — so there is no wrapper and nothing to rewrite.
