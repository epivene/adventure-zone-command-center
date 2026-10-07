const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),appRequire=require('node:module').createRequire(path.join(root,'artifacts/adventure-zone/package.json'));
const ts=process.env.AZ_TYPESCRIPT_PATH?require(process.env.AZ_TYPESCRIPT_PATH):appRequire('typescript');
const React=process.env.AZ_REACT_PATH?require(process.env.AZ_REACT_PATH):appRequire('react');
const {renderToStaticMarkup}=process.env.AZ_REACT_DOM_SERVER_PATH?require(process.env.AZ_REACT_DOM_SERVER_PATH):appRequire('react-dom/server');
const jsx=process.env.AZ_REACT_JSX_PATH?require(process.env.AZ_REACT_JSX_PATH):appRequire('react/jsx-runtime');
const cache=new Map();
function moduleAt(file){
 if(cache.has(file))return cache.get(file);
 const output=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',output)(id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return jsx;if(id.startsWith('.')){const local=path.posix.join(path.posix.dirname(file),id);return moduleAt(local+(fs.existsSync(path.join(root,local+'.tsx'))?'.tsx':'.ts'));}throw Error('Unexpected dependency '+id);},m,m.exports);cache.set(file,m.exports);return m.exports;
}
const dir='artifacts/adventure-zone/src/features/emails/';
test('real email rows render newest first, timestamps, and escaped sender content',()=>{
 const {EmailList}=moduleAt(dir+'email-list.tsx');
 const row=(id,time)=>({id,threadId:id,headers:{from:id==='new'?'<script>sender</script>':'Old sender',to:'',subject:id,date:''},snippet:'Question',labelIds:[],internalDateMs:time,profiles:[],draftId:null,hasAttachments:false});
 const html=renderToStaticMarkup(React.createElement(EmailList,{onSelect:()=>{},items:[row('old',1000),row('new','1791331200000')]}));
 assert.ok(html.indexOf('new</p>')<html.indexOf('old</p>'));assert.ok(html.includes('<time'));assert.ok(!html.includes('Date unavailable'));assert.ok(html.includes('&lt;script&gt;sender&lt;/script&gt;'));assert.ok(html.includes('min-h-20'));
});
test('HTML reader uses a non-scriptable frame and preserves styled content with images opt-in',()=>{
 const {EmailMessageBody,emailHtmlDocument}=moduleAt(dir+'email-message-body.tsx');
 const markup=renderToStaticMarkup(React.createElement(EmailMessageBody,{bodyText:'Text alternative',bodyHtml:'<table><tr><td><b>HTML proposal</b></td></tr></table><script>parent.bad=1</script><img src="https://tracker.test/pixel">'}));
 assert.ok(markup.includes('sandbox="allow-same-origin"'));assert.ok(!markup.includes('allow-scripts'));assert.ok(markup.includes('srcDoc='));assert.ok(markup.includes('Show external images'));
 const defaultDocument=emailHtmlDocument('<b>Proposal</b>');
 assert.ok(defaultDocument.includes("script-src 'none'"));assert.ok(defaultDocument.includes("img-src data:;"));assert.ok(!defaultDocument.includes('img-src data: https:'));
 assert.ok(emailHtmlDocument('<b>Proposal</b>',true).includes('img-src data: https:'));
});
test('plain-only email remains readable without an empty HTML frame',()=>{
 const {EmailMessageBody}=moduleAt(dir+'email-message-body.tsx');
 const markup=renderToStaticMarkup(React.createElement(EmailMessageBody,{bodyText:'Hi there\nOn Monday someone wrote:\n> Previous reply'}));
 assert.ok(!markup.includes('<iframe'));assert.ok(markup.includes('Hi there'));assert.ok(markup.includes('Quoted conversation'));
});

test('email link handling accepts web and mail links and rejects executable or relative URLs',()=>{
 const {emailLinkUrl}=moduleAt(dir+'email-message-body.tsx');
 assert.equal(emailLinkUrl('https://event.test/info'),'https://event.test/info');
 assert.equal(emailLinkUrl('mailto:organizer@event.test'),'mailto:organizer@event.test');
 assert.equal(emailLinkUrl('javascript:alert(1)'),null);assert.equal(emailLinkUrl('data:text/html,hi'),null);assert.equal(emailLinkUrl('/app-action'),null);
});
