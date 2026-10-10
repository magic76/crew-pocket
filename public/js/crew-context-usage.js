/* Shared read-only Context gauge data for Dashboard and Crew World.
 * Never mistake provider credit quota for the active conversation window. */
(() => {
  'use strict';
  let data = {}, at = 0, request = null, available = false;
  const TTL = 25000;
  function get(roleId) {
    return available && Object.prototype.hasOwnProperty.call(data,roleId)
      ? data[roleId] : null;
  }
  function formatTokens(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value >= 1e6) return (value/1e6).toFixed(1).replace(/\.0$/,'')+'M';
    if (value >= 1000) return Math.round(value/1000)+'k';
    return String(Math.round(value));
  }
  function describe(entry) {
    if (!entry || !Number.isFinite(entry.percent) ||
        !Number.isFinite(entry.capacityTokens) || entry.capacityTokens <= 0) {
      return {known:false,label:'—',detail:'Context 尚無可用資料',percent:0,tone:'unknown'};
    }
    const used = Math.max(0,Number(entry.usedTokens)||0);
    const max = Math.max(0,Number(entry.capacityTokens)||0);
    const percent = Math.max(0,entry.percent);
    const approximate = entry.exact !== true;
    const detail = (approximate?'估算 · ':'Provider · ')+
      formatTokens(used)+' / '+formatTokens(max)+' tokens';
    return {
      known:true,label:(approximate?'~':'')+percent+'%',
      detail,percent:Math.min(100,percent),
      tone:percent>=90?'critical':percent>=70?'warning':'healthy'
    };
  }
  async function load({force=false}={}) {
    if (request) return request;
    if (!force && available && Date.now()-at<TTL) return data;
    request = fetch('/api/crew-context-usage',{cache:'no-store',credentials:'same-origin'})
      .then(async response=>{
        if (!response.ok) throw new Error('Context usage unavailable');
        const result=await response.json();
        if (result.success!==true||!result.roles||Array.isArray(result.roles)) throw new Error('Invalid usage data');
        data=result.roles;available=true;at=Date.now();
        window.dispatchEvent(new CustomEvent('crew:context-usage-updated'));
        return data;
      })
      .catch(()=>{
        data={};available=false;at=Date.now();
        window.dispatchEvent(new CustomEvent('crew:context-usage-updated'));
        return data;
      }).finally(()=>{request=null;});
    return request;
  }
  window.CrewContextUsage={get,describe,formatTokens,load};
})();