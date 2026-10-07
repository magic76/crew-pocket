# Crew Pocket ADB operations

Wireless ADB is optional. Offline devices do not require restarting Crew Pocket
and do not block normal chat. Reconnect only when the user requests a device
operation and supplies the current wireless debugging target.

- `~/crew-adb.sh <adb-arguments>`: one bounded call, no reconnect loop.
- `~/set-adb.sh <port-or-IP:port>`: save the target and make one connection attempt.
- `~/install-apk.sh <apk> [target]`: require an online target before installing.

Status/get-state: 3s; connect: 5s; pair: 12s. Device commands first check the
transport and require a device response within 3s. File transfers/installation
allow 120s; shell commands allow 20s. Explicit long-running commands can set
`CREW_ADB_TIMEOUT_SECONDS`; do not extend connection deadlines to keep retrying
an offline device. The installer uses the same target for the required bounded
non-streaming fallback, only while that target remains online.

The API also bounds ADB child processes and shares concurrent status probes.
It matches the device's exact state column, so `offline`/`unauthorized` and the
`List of devices attached` header cannot count as a connection. A failed pairing
stops the subsequent connection. Old successful output is available separately
as `previous_output`, rather than being shown as the current offline result.

Termux ADB commands clear inherited LD_LIBRARY_PATH/LD_PRELOAD. There is no
ADB daemon kill, background retry or automatic wireless-debugging permission
change. ADB deadlines kill the command client, not the Crew server or sessions.

Deploy the three scripts into Termux HOME and keep them executable. Updated
server/lib source is loaded after an explicitly approved Crew Pocket restart.
The existing running process is not restarted during source deployment. APKs
and unrelated user projects/settings/history are unaffected by this change.
