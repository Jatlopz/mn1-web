/** Workbook: Verificar Reporte, F7/F21, H7/H21 and B14:B15. */
export const LAMINATION_DEFAULTS=Object.freeze({faces:'2',inchesPerMetre:'39.37',gramsPerPound:'454',normal:'17',yara:'46.15'});
export const laminationKey=teamId=>'mn1.lamination.v1.'+teamId;
// H7/H21 conditional-format interval in the source workbook, inclusive.
export const LAMINATION_VARIATION_POUNDS=50;
export function laminationVariation(difference) {
 if(typeof difference!=='number'||!Number.isFinite(difference))return 'pending';
 return Math.abs(difference)>LAMINATION_VARIATION_POUNDS?'outside':'within';
}
export const emptyLaminationRow=()=>({width:'',application:'17',labelPounds:'',labelMetres:'',reportedPounds:''});
export function decimal(value,{positive=false,signed=false}={}) {
 const text=String(value??'').trim();
 if(!text)return null;
 if(!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text))return null;
 const number=Number(text.replace(',','.'));
 return Number.isFinite(number)&&(signed||number>=0)&&(!positive||number>0)?number:null;
}
export function calculateLamination(row,settings=LAMINATION_DEFAULTS) {
 const width=decimal(row.width,{positive:true}),application=decimal(row.application,{positive:true}),pounds=decimal(row.labelPounds),metres=decimal(row.labelMetres);
 const faces=decimal(settings.faces,{positive:true}),inches=decimal(settings.inchesPerMetre,{positive:true}),grams=decimal(settings.gramsPerPound,{positive:true}),reported=decimal(row.reportedPounds);
 if([width,application,pounds,metres,faces,inches,grams].includes(null))return {coatingPounds:null,calculatedPounds:null,difference:null};
 const coating=width*faces/inches*application*metres/grams,total=pounds+coating;
 if(!Number.isFinite(total))return {coatingPounds:null,calculatedPounds:null,difference:null};
 return {coatingPounds:coating,calculatedPounds:total,difference:reported===null?null:total-reported};
}
export function calculateSlitter(row) {
 const metres=decimal(row.metres),pounds=decimal(row.pounds,{positive:true}),difference=decimal(row.difference,{signed:true});
 if(metres===null||pounds===null)return {yield:null,metresToRequest:null};
 const value=metres/pounds,result=difference===null?null:value*difference;
 return {yield:Number.isFinite(value)?value:null,metresToRequest:result!==null&&Number.isFinite(result)?result:null};
}
export function createLaminationDraft() {return {version:1,settings:{...LAMINATION_DEFAULTS},rows:[emptyLaminationRow()],slitter:{difference:'',metres:'',pounds:''}};}
export function normalizeLaminationDraft(value) {
 if(!value||value.version!==1||!Array.isArray(value.rows)||!value.rows.length||value.rows.length>50)throw Error('El borrador guardado no es compatible. No se ha reemplazado.');
 const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
 if(!object(value.settings)||!object(value.slitter)||value.rows.some(row=>!object(row)))throw Error('El borrador contiene una estructura no compatible. No se ha reemplazado.');
 const text=value=>{if(typeof value==='string'&&value.length<=40)return value;if(typeof value==='number'&&Number.isFinite(value))return String(value);if(value===undefined||value===null)return '';throw Error('El borrador contiene valores no compatibles. No se ha reemplazado.');};
 const base=createLaminationDraft();
 for(const key of Object.keys(base.settings))base.settings[key]=text(value.settings?.[key]??base.settings[key]);
 base.rows=value.rows.map(row=>Object.fromEntries(Object.keys(emptyLaminationRow()).map(key=>[key,text(row?.[key])])));
 for(const key of Object.keys(base.slitter))base.slitter[key]=text(value.slitter?.[key]);
 return base;
}
