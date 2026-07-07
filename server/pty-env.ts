const UTF8_RE = /utf-?8/i;

export function ptyEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  const hasUtf8Locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].some((value) => value !== undefined && UTF8_RE.test(value));

  if (hasUtf8Locale) return env;

  env.LANG = "en_US.UTF-8";
  delete env.LC_ALL;
  delete env.LC_CTYPE;
  return env;
}
