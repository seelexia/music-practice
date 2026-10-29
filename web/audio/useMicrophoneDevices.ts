import {useCallback,useEffect,useRef,useState} from 'react';
export function useMicrophoneDevices(onError:(message:string)=>void){
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),active=useRef(true),report=useRef(onError);report.current=onError;
 const refresh=useCallback(async()=>{if(!navigator.mediaDevices?.enumerateDevices)return;try{const all=await navigator.mediaDevices.enumerateDevices();if(active.current)setDevices(all.filter(d=>d.kind==='audioinput'));}catch{if(active.current)report.current('无法读取麦克风列表，请检查浏览器的麦克风权限。');}},[]);
 useEffect(()=>{active.current=true;void refresh();navigator.mediaDevices?.addEventListener('devicechange',refresh);return()=>{active.current=false;navigator.mediaDevices?.removeEventListener('devicechange',refresh);};},[refresh]);
 return {devices,refresh};
}
