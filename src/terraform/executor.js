const fs = require('fs');
const { spawn } = require('child_process');

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '');
}

function runCommand(cmd, args, cwd, env, logFilePath, onLine) {
  return new Promise((resolve, reject) => {
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });

    const handleData = (data) => {
      const text = stripAnsi(data.toString());
      logStream.write(text);
      if (onLine) {
        text
          .split('\n')
          .forEach((line) => {
            if (line) onLine(line);
          });
      }
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      logStream.end();
      reject(err);
    });

    child.on('close', (code) => {
      logStream.end();
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

module.exports = { runCommand };
