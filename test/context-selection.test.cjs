const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const script = fs.readFileSync(__dirname + '/../src/main/resources/vditor/context-selection.js', 'utf8');
function snapshot(text) {
    const context = vm.createContext({});
    vm.runInContext(script, context);
    return JSON.parse(JSON.stringify(context.contextSelectionSnapshot(text)));
}
test('small quotations remain exact, including whitespace and emoji', () => {
    const text = 'Quoted 👩🏽 text\n  second paragraph';
    assert.equal(snapshot(text).text, text);
    assert.equal(snapshot(text).length, Array.from(text).length);
});
test('large selections publish bounded endpoints, not the middle', () => {
    const text = 'start '.repeat(20) + 'private middle '.repeat(10000) + 'end '.repeat(30);
    const s = snapshot(text);
    assert.equal(s.head, text.slice(0, 80));
    assert.equal(s.tail, text.slice(-80));
    assert.equal(s.text, '');
    assert.ok(JSON.stringify(s).length < 1000);
});
test('different middles with identical endpoints retain different identities', () => {
    const outer = 'x'.repeat(80);
    assert.notEqual(snapshot(outer + 'one' + outer).id, snapshot(outer + 'two' + outer).id);
});
test('selection events outside editor preserve snapshot; collapsed editor selection clears it', () => {
    let listener, callback, selection, output = [];
    const inside = {nodeType: 1, closest: () => true};
    const outside = {nodeType: 1, closest: () => null};
    const context = vm.createContext({window: {getSelection: () => selection, jsPublishContextSelection: s => output.push(s)},
        document: {addEventListener: (_, fn) => listener = fn}, clearTimeout() {}, setTimeout: fn => callback = fn});
    vm.runInContext(script, context);
    selection = {anchorNode: inside, focusNode: inside, isCollapsed: false, toString: () => 'quotation'};
    listener(); callback(); assert.equal(JSON.parse(output[0]).text, 'quotation');
    selection = {anchorNode: outside}; listener(); callback(); assert.equal(output.length, 1);
    selection = {anchorNode: inside, focusNode: inside, isCollapsed: true}; listener(); callback(); assert.equal(output[1], '');
});
