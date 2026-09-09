#!/bin/zsh
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: zsh scripts/configure-remote-macos.sh --url HTTPS_MCP_URL [--name SERVER_NAME]

The token is read without echo from the terminal and stored in macOS Keychain.
Plain HTTP is accepted only for localhost or 127.0.0.1.
EOF
}

server_name='aidaw_windows'
url=''
while (( $# > 0 )); do
  case "$1" in
    --url) url="${2:-}"; shift 2 ;;
    --name) server_name="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$url" ]]; then
  echo '--url is required.' >&2
  exit 2
fi
case "$server_name" in
  ''|*[!A-Za-z0-9_-]*) echo 'Server name may contain only letters, numbers, underscores and hyphens.' >&2; exit 2 ;;
esac
case "$url" in
  https://*/mcp|http://127.0.0.1:*/mcp|http://localhost:*/mcp) ;;
  *) echo 'Use an HTTPS /mcp URL. Plain HTTP is allowed only for loopback.' >&2; exit 2 ;;
esac
case "$url" in
  *[!A-Za-z0-9:/._?&=%~+-]*) echo 'URL contains unsupported characters.' >&2; exit 2 ;;
esac

if [[ ! -t 0 ]]; then
  echo 'Run this script in an interactive terminal so the token is not passed on the command line.' >&2
  exit 2
fi
printf 'AIDAW bearer token: '
stty -echo
trap 'stty echo' EXIT
IFS= read -r token
stty echo
trap - EXIT
printf '\n'
if (( ${#token} < 32 )); then
  echo 'Token must contain at least 32 characters.' >&2
  exit 2
fi

config_dir="$HOME/.codex"
config_file="$config_dir/config.toml"
bin_dir="$config_dir/bin"
helper="$bin_dir/${server_name}-auth-header"
keychain_service="AIDAW_HTTP_TOKEN_${server_name}"
mkdir -p "$config_dir" "$bin_dir"
touch "$config_file"
backup="$config_file.before-${server_name}.$(date +%Y%m%dT%H%M%S)"
cp "$config_file" "$backup"

security add-generic-password -U -a "$USER" -s "$keychain_service" -w "$token" >/dev/null
unset token

cat > "$helper" <<HELPER_EOF
#!/bin/zsh
set -euo pipefail
token="\$(security find-generic-password -a "\${USER}" -s '$keychain_service' -w)"
printf '{"Authorization":"Bearer %s"}\\n' "\${token}"
HELPER_EOF
chmod 700 "$helper"

temporary="$(mktemp)"
awk -v header="[mcp_servers.${server_name}]" -v nested="[mcp_servers.${server_name}." '
BEGIN { skip=0 }
$0 == header || index($0,nested) == 1 { skip=1; next }
skip && /^\[/ { skip=0 }
!skip { print }
' "$config_file" > "$temporary"
mv "$temporary" "$config_file"

cat >> "$config_file" <<CONFIG_EOF

[mcp_servers.${server_name}]
url = "$url"
http_headers_helper = "$helper"
startup_timeout_sec = 30
tool_timeout_sec = 300
CONFIG_EOF

echo "Configured ${server_name} in ${config_file}."
echo "Backup: ${backup}"
echo 'Quit and reopen Codex, then enter /mcp to verify the connection.'
