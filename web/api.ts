import type {Asset,Job,Song} from './types';
export class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers); headers.set('X-Music-Client','web');
  if(options.body&&typeof options.body==='string')headers.set('Content-Type','application/json');
  const response=await fetch(path.startsWith('/api/')?path:`/api${path}`,{...options,headers});
  if(!response.ok){let message=`请求失败 (${response.status})`;try{message=(await response.json()).error||message;}catch{}
    throw new ApiError(response.status===409?`保存版本发生冲突，请保留本地修改并刷新后重新合并。${message}`:message,response.status);}
  return response.json();
}
export function patchSong(song:Song,changes:Partial<Song>){return api<Song>(`/songs/${song.id}`,{method:'PATCH',body:JSON.stringify({...changes,revision:song.revision})});}
export async function recheckJob(songId:string,jobId:string):Promise<Job[]>{
  await api<Job>(`/songs/${songId}/jobs/${jobId}/recheck`,{method:'POST',body:'{}'});
  return api<Job[]>(`/songs/${songId}/jobs`);
}
export async function uploadAsset(songId:string,file:File,kind:Asset['kind']):Promise<Song>{
  if(file.size>100*1024*1024)throw new Error('单个文件不能超过 100 MB');
  return api<Song>(`/songs/${songId}/assets?kind=${kind}`,{method:'POST',body:file,headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)}});
}
export function downloadText(name:string,text:string,mime='text/plain;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
