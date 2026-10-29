import {useEffect,useRef,useState,type RefObject} from 'react';

/** Expand inside the browser viewport. Esc restores the surrounding page. */
export function usePageFullscreen(resetKey?:string){
  const [pageFullscreen,setPageFullscreen]=useState(false);
  useEffect(()=>setPageFullscreen(false),[resetKey]);
  useEffect(()=>{
    if(!pageFullscreen)return;
    const root=document.documentElement,previous=root.style.overflow;
    root.style.overflow='hidden';
    const panel=document.querySelector<HTMLElement>('.practice-panel.is-page-fullscreen'),previousFocus=document.activeElement;
    panel?.querySelector<HTMLElement>('button')?.focus();
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setPageFullscreen(false);}else if(event.key==='Tab'&&panel){const controls=[...panel.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')].filter(element=>element.getClientRects().length&&!element.hasAttribute('disabled'));const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    window.addEventListener('keydown',escape,true);
    return()=>{root.style.overflow=previous;window.removeEventListener('keydown',escape,true);if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus();};
  },[pageFullscreen]);
  return {pageFullscreen,togglePageFullscreen:()=>setPageFullscreen(value=>!value),exitPageFullscreen:()=>setPageFullscreen(false)};
}

export function VerticalResizeHandle({target,height,onHeight,label,min=320,max=1600}:{target:RefObject<HTMLElement|null>;height:number|null;onHeight:(value:number|null)=>void;label:string;min?:number;max?:number}){
  const drag=useRef<{y:number;height:number}|null>(null),[measured,setMeasured]=useState(min);
  useEffect(()=>{const element=target.current;if(!element)return;const update=()=>setMeasured(Math.round(element.getBoundingClientRect().height));update();const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();},[target]);
  const maximum=Math.max(max,typeof window==='undefined'?max:window.innerHeight*2);
  const clamp=(value:number)=>Math.max(min,Math.min(maximum,Math.round(value)));
  return <div className="vertical-resize-handle" role="separator" tabIndex={0} aria-label={label} aria-orientation="horizontal" aria-valuemin={min} aria-valuemax={maximum} aria-valuenow={height??measured} title="上下拖动或使用方向键调整高度；双击恢复默认" onDoubleClick={()=>onHeight(null)} onPointerDown={event=>{const element=target.current;if(!element)return;event.preventDefault();drag.current={y:event.clientY,height:element.getBoundingClientRect().height};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(drag.current)onHeight(clamp(drag.current.height+event.clientY-drag.current.y));}} onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={event=>{let next:number|undefined;if(event.key==='ArrowUp')next=(height??measured)-24;else if(event.key==='ArrowDown')next=(height??measured)+24;else if(event.key==='Home')next=min;else if(event.key==='End')next=maximum;else if(event.key==='Enter'){event.preventDefault();onHeight(null);return;}if(next!==undefined){event.preventDefault();onHeight(clamp(next));}}}><i/><span>拖动调整高度 · 双击恢复</span></div>;
}
