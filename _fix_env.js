const fs = require('fs');
let c = fs.readFileSync('.env', 'utf8');
c = c.replace(/^TEAM_\w+_BEID=.*\n?/gm, '');
c = c.replace(/^# .+BEID:.+\n/gm, '');
c = c.replace(/^# .+Optional extra identifier.+\n/gm, '');
if (c.indexOf('BE_ID=') === -1) {
  c = c.replace(/(DEV_LOG=\S*)/, '$1\n\n# Back-end user ID - has admin-level access across all teams\nBE_ID=');
}
fs.writeFileSync('.env', c, 'utf8');
console.log('Done');
