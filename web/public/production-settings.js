import {catalogKey} from './plant-catalog.js';
import {openProductionData,productionDefaultsKey,normalizeProductionDefaults,productionOrderKey,normalizeProductionOrder} from './production-studio.js';
import {productionDraftKey} from './production-model.js';
import {loomConfigKey,createLoomConfig,normalizeLoomConfig,provisionSacosLooms} from './looms-model.js';
import {laminationKey,createLaminationDraft,normalizeLaminationDraft} from './lamination-model.js';

const marker = plant => 'mn1.prod.source.'+plant;
const parse = raw => raw===null || raw===undefined ? null : JSON.parse(raw);
const same = (a,b) => {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
const settingsKeys=(plant,team)=>({
  catalog:catalogKey(plant),defaults:productionDefaultsKey(plant),order:productionOrderKey(team),
  looms:loomConfigKey(team),lamination:laminationKey(team)
});

function publicLoomConfig(value,plant) {
  const config=normalizeLoomConfig(value||createLoomConfig());
  const result=plant==='sacos'?provisionSacosLooms(config):config;
  return {...result,people:result.people.map(({id,name,enabled})=>({id,name,enabled}))};
}

export async function collectProductionSettings(storage,plant,team){
  const keys=settingsKeys(plant,team);
  const [catalog,defaults,order,looms,lamination,draft]=await Promise.all(
    [...Object.values(keys),productionDraftKey(team)].map(async key=>parse(await storage.getText(key)))
  );
  return {
    catalog:openProductionData(catalog??draft?.catalogSnapshot,null,{teamId:team,plantId:plant}).catalog,
    defaults:normalizeProductionDefaults(defaults),order:normalizeProductionOrder(order),
    looms:publicLoomConfig(looms,plant),
    lamination:(lamination?normalizeLaminationDraft(lamination):createLaminationDraft()).settings
  };
}

// The owner explicitly selects the device and team whose existing settings become the plant reference.
export async function publishProductionSettings(storage,api,plant,team,expected,reviewed){
  const settings=reviewed??await collectProductionSettings(storage,plant,team);
  const revision=await api.publish(plant,team,expected,settings);
  await storage.putText(marker(plant),JSON.stringify({team,revision}));
  if(plant==='sacos')await storage.putText('mn1.loom.share.'+team,'1');
  return revision;
}

export function productionSettingsStorage(local,api){
  let plant,team,keys={},state=null,bound=null,reader=false;
  let queue=Promise.resolve(),offline=false;
  const section=key=>Object.keys(keys).find(part=>keys[part]===key);
  const origin=()=>bound?.team===team&&state?.canPublish&&state.item?.team===team;
  const message=()=>state?.item?(origin()?'Configuración de planta vinculada a este equipo.':'Configuración de planta compartida por administración.'):offline?'Configuración local. Inicia sesión como supervisor o vuelve a abrir la herramienta con conexión.':'';
  return {
    get persistent(){return local.persistent;},
    get receivesSettings(){return reader;},
    message,
    async prepare(nextPlant,nextTeam){
      await queue;
      plant=nextPlant;team=nextTeam;keys=settingsKeys(plant,team);state=null;reader=false;offline=false;
      bound=parse(await local.getText(marker(plant)));
      try{state=await api.read(plant);}catch{offline=true;return;}
      reader=Boolean(state?.item&&!origin());
    },
    async getText(key){
      const part=section(key);
      if(!reader||!part)return local.getText(key);
      const value=state.item.settings[part];
      if(part==='order'&&value===null)return null;
      if(part==='lamination'){
        const raw=parse(await local.getText(key));
        const draft=raw?normalizeLaminationDraft(raw):createLaminationDraft();
        draft.settings=value;return JSON.stringify(draft);
      }
      if(part==='looms'){
        const raw=parse(await local.getText(key));
        const photos=new Map((raw?.people||[]).map(person=>[person.id,person.photoKey||'']));
        return JSON.stringify({...value,people:value.people.map(person=>({...person,photoKey:photos.get(person.id)||''}))});
      }
      return JSON.stringify(value);
    },
    async putText(key,raw){
      const part=section(key);
      if(!part)return local.putText(key,raw);
      const value=parse(raw);
      const setting=part==='looms'?publicLoomConfig(value,plant):part==='lamination'?value.settings:value;
      if(reader && !same(setting,state.item.settings[part]))throw Error('La configuración compartida se edita desde el equipo de administración.');
      if(reader && part!=='lamination')return;
      if(reader && part==='lamination'){
        const original=parse(await local.getText(key));
        return local.putText(key,JSON.stringify({...value,settings:original?.settings||createLaminationDraft().settings}));
      }
      if(bound?.team!==team)return local.putText(key,raw);
      const save=async()=>{
        if(!origin()&&part==='lamination'){const saved=parse(await local.getText(key))||createLaminationDraft();if(same(saved.settings,setting))return local.putText(key,raw);}
        if(!origin())throw Error('Conecta la cuenta administradora para guardar la configuración compartida.');
        if(same(setting,state.item.settings[part]))return local.putText(key,raw);
        if(bound.revision!==state.item.revision)throw Error('La configuración cambió en otro dispositivo. Revisa la versión desde Administración.');
        const settings={...state.item.settings,[part]:setting};
        const revision=await api.publish(plant,team,bound.revision,settings);
        await local.putText(key,raw);
        state.item={...state.item,settings,revision};bound={team,revision};
        await local.putText(marker(plant),JSON.stringify(bound));
      };
      const task=queue.then(save);queue=task.catch(()=>{});return task;
    }
  };
}
