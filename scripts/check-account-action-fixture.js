(async()=>{
 const c=window.__transcriptUIFixture,root=()=>document.querySelector('.st-fullscreen-modal'),real=app.plugins.plugins['nomad-transcripts'];if(!c||!root()||real.task||!real.progress.paused)throw Error('Require isolated test and idle paused production');
 const before={config:JSON.stringify(real.config),cache:JSON.stringify(real.store),session:JSON.stringify(real.chatGPT.record),costs:JSON.stringify(real.costs)};
 const click=text=>{const button=[...root().querySelectorAll('button')].find(b=>b.textContent===text);if(!button)throw Error('Missing '+text);button.click();};const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 root().querySelector('[aria-label="Settings"]').click();const provider=root().querySelector('select');provider.value='subscription';provider.dispatchEvent(new Event('change'));
 click('Connect ChatGPT account');await settle();if(c.accountActionCalls.connect!==1)throw Error('Connect lost context');
 click('Finish sign-in');await settle();if(c.accountActionCalls.finish!==1||!c.subscriptionStatus.connected)throw Error('Finish lost context');
 click('Disconnect');await settle();if(c.accountActionCalls.disconnect!==1||c.subscriptionStatus.connected)throw Error('Disconnect lost context');
 let unhandled=false;const failed=e=>{if(e.reason?.message==='Isolated synchronous account failure')unhandled=true;};window.addEventListener('unhandledrejection',failed);
 try{c.finishSubscriptionLogin=function(){throw Error('Isolated synchronous account failure');};click('Finish sign-in');await settle();await settle();if(unhandled||![...document.querySelectorAll('.notice')].some(n=>n.innerText.includes('Isolated synchronous account failure')))throw Error('Synchronous error was not displayed safely');}
 finally{window.removeEventListener('unhandledrejection',failed);for(const notice of document.querySelectorAll('.notice'))if(notice.innerText.includes('Isolated synchronous account failure'))notice.remove();}
 click('Cancel');
 const preserved=before.config===JSON.stringify(real.config)&&before.cache===JSON.stringify(real.store)&&before.session===JSON.stringify(real.chatGPT.record)&&before.costs===JSON.stringify(real.costs);
 if(!preserved||!real.subscriptionStatus.connected||!real.progress.paused||real.task)throw Error('Real session/work changed');
 return {compiledUIRegression:true,connectContext:true,finishContext:true,disconnectContext:true,synchronousErrorHandled:true,realSessionAndSettingsPreserved:preserved,recognitionRequests:0};
})();
