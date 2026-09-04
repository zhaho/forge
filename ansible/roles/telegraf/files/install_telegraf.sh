# Per InfluxData's current install docs (the old influxdata-archive_compat.key /
# trusted.gpg.d approach is deprecated and no longer matches the key they sign
# the repo with, which is what caused the previous NO_PUBKEY failures).
sudo mkdir -p /etc/apt/keyrings
curl --silent --location -O https://repos.influxdata.com/influxdata-archive.key
gpg --show-keys --with-fingerprint --with-colons ./influxdata-archive.key 2>&1 \
  | grep -q '^fpr:\+24C975CBA61A024EE1B631787C3D57159FC2F927:$' \
  && cat influxdata-archive.key \
  | gpg --dearmor \
  | sudo tee /etc/apt/keyrings/influxdata-archive.gpg > /dev/null \
  && echo 'deb [signed-by=/etc/apt/keyrings/influxdata-archive.gpg] https://repos.influxdata.com/debian stable main' \
  | sudo tee /etc/apt/sources.list.d/influxdata.list
rm -f influxdata-archive.key
sudo apt-get update
# telegraf pulls in influxdata-archive-keyring, whose postinst manages
# /etc/apt/sources.list.d/influxdata.list via ucf - the same file we just wrote
# by hand above, which makes ucf prompt interactively ("keep or install new
# conffile?") and hang forever with no TTY. Force non-interactive + keep our
# existing file so that never happens.
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold" \
  telegraf
