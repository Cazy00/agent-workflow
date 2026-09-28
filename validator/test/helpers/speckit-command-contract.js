import assert from 'node:assert/strict';
export function assertCommandBoundary(text,command,integration) {
  assert.match(text,/POLICY\.md governs/);
  assert.ok(text.includes(`--integration ${integration}`),'materialized integration is explicit');
  if(command==='constitution') {
    assert.match(text,/propose-authority/);assert.match(text,/without writing the project/);
    assert.match(text,/No separate owner bookkeeping approval/);assert.doesNotMatch(text,/send: true|__AGENT__/);return;
  }
  assert.match(text,/SPECIFY_FEATURE_NO_PERSIST=1/);
  assert.match(text,/never create it, even if the embedded prompt explicitly asks/);
  assert.match(text,/Four reserved unknowns mean four retained decisions/);
  assert.match(text,/Disable upstream.*hooks, workflow runner.*automatic handoffs/);
  assert.doesNotMatch(text,/send: true/);
  assert.doesNotMatch(text,/\{CORE_TEMPLATE\}|__AGENT__/);
  if (command==='implement') {
    assert.match(text,/Require one explicit T-NNNN/);
    assert.match(text,/perform only the explicitly selected task\/subset after the readiness checks below/);
    assert.doesNotMatch(text,/no implementation authority|or implementation follow from this command/);
    assert.match(text,/normal readiness check/);
    assert.match(text,/never tick generated tasks\.md/);
    assert.match(text,/separate context using canonical sources without this conversation/);
    assert.doesNotMatch(text,/Execute all tasks|mark.*\[X\]/i);
  }
  if(command==='tasks') {
    assert.match(text,/Required tests and independent review are never optional/);
    assert.match(text,/write-tasks --plan EXTERNAL_JSON --open-pulls EXTERNAL_JSON/);
    assert.match(text,/Drafts only/);
  }
  if(command==='plan') {
    assert.match(text,/Reuse adequate approved design and contracts/);
    assert.match(text,/instruction to generate and dispatch research agents for each unknown or technology is disabled/);
    assert.match(text,/One coordinator performs ordinary research/);
  }
  if(['specify','clarify','plan'].includes(command)) {
    const embedded=text.indexOf('## Embedded upstream planning guidance');
    assert.ok(embedded>text.indexOf('## Native workflow boundary'));
    assert.ok(text.lastIndexOf('## Native completion boundary')>embedded);
    assert.match(text,/## Outline/,'actual upstream body is composed');
  }
}
