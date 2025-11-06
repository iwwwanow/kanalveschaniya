// import { Constants } from "youtubei.js";
// import { services } from "../processing/service-config.js";
// import { updateEnv, canonicalEnv, env as currentEnv } from "./config";
//
// import { FileWatcher } from "../misc/file-watcher.js";
// import { isURL } from "../misc/utils.js";
// import * as cluster from "../misc/cluster.js";
// import { Green, Yellow } from "../misc/console-text.js";

const forceLocalProcessingOptions = ["never", "session", "always"];
const youtubeHlsOptions = ["never", "key", "always"];

const httpProxyVariables = ["NO_PROXY", "HTTP_PROXY", "HTTPS_PROXY"].flatMap(
  k => [k, k.toLowerCase()]
);

const changeCallbacks = {};

const onEnvChanged = (changes) => {
  for (const key of changes) {
    if (changeCallbacks[key]) {
      changeCallbacks[key].map(fn => {
        try { fn() } catch { }
      });
    }
  }
}

const subscribe = (keys, fn) => {
  keys = [keys].flat();

  for (const key of keys) {
    if (key in currentEnv && key !== 'subscribe') {
      changeCallbacks[key] ??= [];
      changeCallbacks[key].push(fn);
      fn();
    } else throw `invalid env key ${key}`;
  }
}


const reloadEnvs = async (contents) => {
  const newEnvs = {};
  const resolvedContents = await contents;

  for (let line of resolvedContents.split('\n')) {
    line = line.trim();
    if (line === '') {
      continue;
    }

    let [key, value] = line.split(/=(.+)?/);
    if (key) {
      if (value.match(/^['"]/) && value.match(/['"]$/)) {
        value = JSON.parse(value);
      }

      newEnvs[key] = value || '';
    }
  }

  const candidate = {
    ...canonicalEnv,
    ...newEnvs,
  };

  const parsed = await validateEnvs(
    loadEnvs(candidate)
  );

  cluster.broadcast({ env_update: resolvedContents });
  return updateEnv(parsed);
}

const wrapReload = (contents) => {
  reloadEnvs(contents)
    .then(changes => {
      if (changes.length === 0) {
        return;
      }

      onEnvChanged(changes);

      console.log(`${Green('[✓]')} envs reloaded successfully!`);
      for (const key of changes) {
        const value = currentEnv[key];
        const isSecret = key.toLowerCase().includes('apikey')
          || key.toLowerCase().includes('secret')
          || key === 'httpProxyValues';

        if (!value) {
          console.log(`    removed: ${key}`);
        } else {
          console.log(`    changed: ${key} -> ${isSecret ? '***' : value}`);
        }
      }
    })
    .catch((e) => {
      console.error(`${Yellow('[!]')} Failed reloading environment variables at ${new Date().toISOString()}.`);
      console.error('Error:', e);
    });
}

let watcher;
const setupWatcherFromFile = (path) => {
  const load = () => wrapReload(watcher.read());

  if (isURL(path)) {
    watcher = FileWatcher.fromFileProtocol(path);
  } else {
    watcher = new FileWatcher({ path });
  }

  watcher.on('file-updated', load);
  load();
}

const setupWatcherFromFetch = (url) => {
  const load = () => wrapReload(fetch(url).then(r => r.text()));
  setInterval(load, currentEnv.envRemoteReloadInterval);
  load();
}

export const setupEnvWatcher = () => {
  if (cluster.isPrimary) {
    const envFile = currentEnv.envFile;
    const isFile = !isURL(envFile)
      || new URL(envFile).protocol === 'file:';

    if (isFile) {
      setupWatcherFromFile(envFile);
    } else {
      setupWatcherFromFetch(envFile);
    }
  } else if (cluster.isWorker) {
    process.on('message', (message) => {
      if ('env_update' in message) {
        reloadEnvs(message.env_update);
      }
    });
  }
}
