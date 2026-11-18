const main = (config) => {
  const rejectQuic = "AND,((DST-PORT,443),(NETWORK,UDP)),REJECT";
  config.rules = [
    rejectQuic,
    ...(config.rules || []).filter((rule) => rule !== rejectQuic),
  ];

  config.sniffer = {
    ...(config.sniffer || {}),
    enable: true,
    "override-destination": true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    sniff: {
      ...((config.sniffer || {}).sniff || {}),
      TLS: {
        ports: [443],
        "override-destination": true,
      },
      HTTP: {
        ports: [80, "8080-8880"],
        "override-destination": true,
      },
    },
  };

  return config;
};
