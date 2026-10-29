import {useEffect,useState,type RefObject} from 'react';
import {ArrowUp,Pause,Play} from 'lucide-react';
import type {PlaybackState} from '../audio/engine';
import './floating-transport.css';

type Props={workspace:RefObject<HTMLDivElement|null>;mainButton:RefObject<HTMLButtonElement|null>;title:string;beat:number;state:PlaybackState;disabled:boolean;onToggle:()=>void;onVisibilityChange:(visible:boolean)=>void};
export default function FloatingPracticeTransport({workspace,mainButton,title,beat,state,disabled,onToggle,onVisibilityChange}:Props){
 const [dock,setDock]=useState({visible:false,left:12,right:12});
 useEffect(()=>{
  const area=workspace.current,button=mainButton.current;if(!area||!button)return;
  let areaVisible=false,buttonVisible=true;
  const update=()=>{
   const bounds=area.getBoundingClientRect(),visible=areaVisible&&!buttonVisible&&bounds.width>0&&bounds.height>0;
   const left=Math.max(12,Math.min(innerWidth-12,bounds.left+12)),right=Math.max(12,innerWidth-Math.min(innerWidth-12,bounds.right-12));
   setDock(old=>old.visible===visible&&old.left===left&&old.right===right?old:{visible,left,right});
  };
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===area)areaVisible=entry.isIntersecting;if(entry.target===button)buttonVisible=entry.isIntersecting&&entry.intersectionRatio>=.6;}update();},{threshold:[0,.6,1]});
  observer.observe(area);observer.observe(button);const resize=new ResizeObserver(update);resize.observe(area);window.addEventListener('resize',update);
  return()=>{observer.disconnect();resize.disconnect();window.removeEventListener('resize',update);};
 },[workspace,mainButton]);
 useEffect(()=>{onVisibilityChange(dock.visible);return()=>onVisibilityChange(false);},[dock.visible,onVisibilityChange]);
 if(!dock.visible)return null;
 const paused=state==='paused';
 return <section className="floating-practice-transport" role="region" aria-label="浮动播放控制" style={{left:dock.left,right:dock.right}}>
  <div className="floating-transport-info"><strong>{title}</strong><span>第 {Math.floor(beat)+1} 拍 · {paused?'已暂停':state==='loop-gap'?'循环间隔':'播放中'}</span></div>
  <button type="button" className="floating-transport-toggle" disabled={disabled} aria-label={paused?'浮动播放':'浮动暂停'} onClick={onToggle}>{paused?<Play size={19} fill="currentColor"/>:<Pause size={19}/>}<span>{paused?'播放':'暂停'}</span></button>
  <button type="button" className="floating-transport-return" aria-label="返回播放控制" title="返回播放控制" onClick={()=>{mainButton.current?.scrollIntoView({block:'center',behavior:'smooth'});mainButton.current?.focus({preventScroll:true});}}><ArrowUp size={17}/><span>主控</span></button>
 </section>;
}
