import {configForVersion} from '../zero-cache/vitest.config.ts';

const config = configForVersion(17, import.meta.url);
config.test.include = [
  'src/**/*.pg.test.?(c|m)[jt]s?(x)',
  'src/**/*.bench.test.?(c|m)[jt]s?(x)',
];
export default config;
