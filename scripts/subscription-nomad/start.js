(async()=>{const p=app.plugins.plugins['nomad-subscription-test'];await p.signIn();return {started:!!p.record.pending,status:p.status};})();
