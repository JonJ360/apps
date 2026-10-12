'use strict';
window.HubAuth=(()=>{
 let generation=0;
 async function refresh(){
  const revision=++generation;
  renderApps();
  try{
   const identity=await Shared360Session.current();
   if(revision!==generation)return;
   renderApps(identity?.user);
   document.getElementById('identity-status').textContent=identity?'Using your existing 360 sign-in.':'Private apps use your existing AR or Asset Register sign-in.';
  }catch{
   if(revision===generation)document.getElementById('identity-status').textContent='Could not verify your 360 session. Existing public apps remain available.';
  }
 }
 // Do not await SDK methods inside its auth callback (the SDK holds a lock).
 Shared360Session.client.auth.onAuthStateChange(()=>{renderApps();setTimeout(refresh,0);});
 window.addEventListener('focus',refresh);
 window.addEventListener('storage',refresh);
 refresh();
 return {refresh};
})();
