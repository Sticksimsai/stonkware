// pm2 process file. Runs the API + built-in scheduler (fee claims, agent shifts) in one process.
module.exports = {
  apps: [
    {
      name: "firmware",
      cwd: __dirname + "/..",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${process.env.PORT || 3000} -H 127.0.0.1`,
      env: { NODE_ENV: "production", RUN_SCHEDULER: "1", PORT: process.env.PORT || "3000" },
      max_memory_restart: "1500M",
      kill_timeout: 10000,
      out_file: process.env.HOME + "/logs/firmware.out.log",
      error_file: process.env.HOME + "/logs/firmware.err.log",
      time: true,
    },
  ],
};
