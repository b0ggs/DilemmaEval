import { posix } from 'node:path';

/** Change only the known per-call plugin selection; preserve all receipts,
 * model/auth settings, unrelated plugins and private player state. Refresh the
 * native process after this command, before any inference. */
export function buildObserverTransitionCommand({ artifact, enabled = false }) {
  if (!artifact || !['openclaw', 'hermes'].includes(artifact.harness) || typeof enabled !== 'boolean') throw new Error('OBSERVER_TRANSITION_INVALID');
  const settingsPath = artifact.gameplay_command[2];
  const base = posix.dirname(settingsPath);
  if (artifact.harness === 'openclaw') {
    return ['node', '--input-type=module', '-e', `
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
try {
 const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8')),enabled=process.argv[2]==='true',p=s.openclaw_config_path;
 const st=fs.lstatSync(p);if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(p)!==p)throw 0;
 const text=fs.readFileSync(p,'utf8'),c=JSON.parse(text),id='conference-oauth-observer';
 const entry=c.plugins?.entries?.[id];
 if(entry!==undefined){if(!entry||typeof entry!=='object'||Array.isArray(entry))throw 0;entry.enabled=enabled;}
 else if(enabled)throw 0;
 const next=JSON.stringify(c,null,2)+'\\n';
 if(next!==text){const tmp=p+'.observer-transition.'+randomUUID()+'.tmp',fd=fs.openSync(tmp,'wx',st.mode&0o777);
  try{fs.writeFileSync(fd,next);fs.fchownSync(fd,st.uid,st.gid);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,p);const d=fs.openSync(p.slice(0,p.lastIndexOf('/')),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
 process.stdout.write(JSON.stringify({schema_version:1,seat_id:s.seat_id,observer_enabled:enabled,process_refresh_required:true}));
}catch{process.stdout.write('{"ok":false,"error":{"code":"OBSERVER_TRANSITION_FAILED"}}');process.exitCode=1;}
`, settingsPath, String(enabled)];
  }
  // Use the existing native Python environment for YAML, with the native UID.
  const source = `
import os,sys,json,pathlib,stat
if os.geteuid()==0: os.setgroups([]);os.setgid(10000);os.setuid(10000)
os.execve('/opt/hermes/.venv/bin/python',['/opt/hermes/.venv/bin/python','-B','-c',sys.argv[1],sys.argv[2],sys.argv[3]],dict(os.environ,HOME='/opt/data',HERMES_HOME='/opt/data'))
`;
  const script = `
import os,sys,json,pathlib,stat,yaml,uuid
try:
 s=json.loads(pathlib.Path(sys.argv[1]).read_text());enabled=sys.argv[2]=='true';p=pathlib.Path(s['hermes_config_path'])
 st=os.lstat(p)
 if not stat.S_ISREG(st.st_mode) or p.resolve()!=p or st.st_uid!=10000 or st.st_gid!=10000: raise ValueError()
 text=p.read_text();node=yaml.compose(text);name='dilemma-conference-oauth'
 def child(mapping,key):
  if not isinstance(mapping,yaml.MappingNode): raise ValueError()
  rows=[v for k,v in mapping.value if k.value==key]
  if len(rows)>1: raise ValueError()
  return rows[0] if rows else None
 plugins=child(node,'plugins')
 if plugins is None:
  if enabled: raise ValueError()
  text+='\\nplugins:\\n  disabled: ['+json.dumps(name)+']\\n'
 else:
  disabled=child(plugins,'disabled')
  if disabled is None:
   if not enabled: text=text[:plugins.end_mark.index]+'  disabled: ['+json.dumps(name)+']\\n'+text[plugins.end_mark.index:]
  else:
   managed=text[disabled.start_mark.index:disabled.end_mark.index]
   if any(isinstance(token,(yaml.tokens.AnchorToken,yaml.tokens.AliasToken)) for token in yaml.scan(managed)): raise ValueError()
   names=yaml.safe_load(managed)
   if not isinstance(names,list) or any(not isinstance(x,str) for x in names): raise ValueError()
   names=[x for x in names if x!=name] if enabled else names if name in names else names+[name]
   text=text[:disabled.start_mark.index]+json.dumps(names)+text[disabled.end_mark.index:]
 if text!=p.read_text():
  tmp=pathlib.Path(str(p)+'.observer-transition.'+uuid.uuid4().hex+'.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as out: out.write(text);out.flush();os.fsync(out.fileno())
  os.replace(tmp,p)
  parent=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try: os.fsync(parent)
  finally: os.close(parent)
 print(json.dumps({'schema_version':1,'seat_id':s['seat_id'],'observer_enabled':enabled,'process_refresh_required':True},separators=(',',':')))
except Exception:
 print('{"ok":false,"error":{"code":"OBSERVER_TRANSITION_FAILED"}}');sys.exit(1)
`;
  return ['python3', '-c', source, script, settingsPath, String(enabled)];
}

/** Confirm the selection after process refresh/snapshot restoration. */
export function buildObserverInspectionCommand({ artifact }) {
  const settingsPath = artifact.gameplay_command[2];
  if (artifact.harness === 'openclaw') return ['node', '--input-type=module', '-e', `
import fs from 'node:fs';try{const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8')),
c=JSON.parse(fs.readFileSync(s.openclaw_config_path,'utf8'));
console.log(JSON.stringify({schema_version:1,seat_id:s.seat_id,observer_enabled:c.plugins?.entries?.['conference-oauth-observer']?.enabled===true}));
}catch{console.log('{"ok":false,"error":{"code":"OBSERVER_TRANSITION_FAILED"}}');process.exitCode=1;}
`, settingsPath];
  if (artifact.harness !== 'hermes') throw new Error('OBSERVER_TRANSITION_INVALID');
  return ['/opt/hermes/.venv/bin/python', '-B', '-c', `
import sys,json,pathlib,yaml
try:
 s=json.loads(pathlib.Path(sys.argv[1]).read_text());c=yaml.safe_load(pathlib.Path(s['hermes_config_path']).read_text());p=c.get('plugins',{})
 enabled=p.get('enabled',[]);disabled=p.get('disabled',[])
 if not isinstance(enabled,list) or not isinstance(disabled,list): raise ValueError()
 print(json.dumps({'schema_version':1,'seat_id':s['seat_id'],'observer_enabled':'dilemma-conference-oauth' in enabled and 'dilemma-conference-oauth' not in disabled}))
except Exception:
 print('{"ok":false,"error":{"code":"OBSERVER_TRANSITION_FAILED"}}');sys.exit(1)
`, settingsPath];
}
