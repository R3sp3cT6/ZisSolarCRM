'use client';
import {useEffect} from 'react';
export function VisitTracker(){useEffect(()=>{let last=0;const track=()=>{if(document.visibilityState!=='visible'||Date.now()-last<60000)return;last=Date.now();void fetch('/api/visit',{method:'POST'}).catch(()=>{});};track();document.addEventListener('visibilitychange',track);window.addEventListener('focus',track);return()=>{document.removeEventListener('visibilitychange',track);window.removeEventListener('focus',track);};},[]);return null;}
