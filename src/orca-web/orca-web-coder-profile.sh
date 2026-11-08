# Sourced by login shells, including Coder SSH and VS Code environment probes.
# The devcontainer lifecycle hook runs before Coder prepares session variables.
if [ "${CODER:-}" = true ] && [ -n "${GIT_SSH_COMMAND:-}" ] &&
    [ "$(id -un)" = "$(cat /etc/orca-web-user 2>/dev/null)" ]; then
    # Detach without printing or persisting environment values. The command
    # serializes adoption and leaves subsequent sessions untouched.
    nohup /usr/local/bin/orca-web inherit-environment </dev/null >/dev/null 2>&1 &
fi
