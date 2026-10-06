const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),appRequire=require('node:module').createRequire(path.join(root,'artifacts/adventure-zone/package.json'));
const ts=process.env.AZ_TYPESCRIPT_PATH?require(process.env.AZ_TYPESCRIPT_PATH):appRequire('typescript');
const React=process.env.AZ_REACT_PATH?require(process.env.AZ_REACT_PATH):appRequire('react');
const {renderToStaticMarkup}=process.env.AZ_REACT_DOM_SERVER_PATH?require(process.env.AZ_REACT_DOM_SERVER_PATH):appRequire('react-dom/server');
const jsx=process.env.AZ_REACT_JSX_PATH?require(process.env.AZ_REACT_JSX_PATH):appRequire('react/jsx-runtime');
function component(file,name){
 const out=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',out)(id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return jsx;throw Error('Unexpected dependency '+id);},m,m.exports);return m.exports[name];
}
const dir='artifacts/adventure-zone/src/features/emails/';
test('email list renders selection, sender, subject and one-line preview with escaped customer text',()=>{
 const EmailList=component(dir+'email-list.tsx','EmailList');
 const html=renderToStaticMarkup(React.createElement(EmailList,{selectedId:'m',onSelect:()=>{},items:[{id:'m',threadId:'t',headers:{from:'Customer',to:'',subject:'<script>bad</script>',date:''},snippet:'Question',labelIds:['UNREAD'],internalDateMs:1,profiles:[],draftId:null,hasAttachments:true}]}));
 assert.ok(html.includes('aria-pressed="true"'));assert.ok(html.includes('Customer'));assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(html.includes('Question'));assert.ok(html.includes('Unread'));
});
test('reader preserves a readable pane and phone visibility state',()=>{
 const EmailReader=component(dir+'email-reader.tsx','EmailReader');
 const html=renderToStaticMarkup(React.createElement(EmailReader,{hiddenOnPhone:true},React.createElement('p',null,'Full thread')));
 assert.ok(html.includes('aria-label="Email conversation"'));assert.ok(html.includes('hidden md:block'));assert.ok(html.includes('Full thread'));
});
