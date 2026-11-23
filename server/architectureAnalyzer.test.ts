import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeProjectArchitecture } from './architectureAnalyzer';

test('analyzeProjectArchitecture inspects workspace and detects core patterns & suggestions', () => {
  const report = analyzeProjectArchitecture(path.resolve(process.cwd()));

  assert.ok(report.totalFiles > 20, 'Should scan real workspace files');
  assert.ok(report.totalCodeFiles > 15, 'Should count real code files');
  assert.ok(report.totalLines > 1000, 'Should calculate total code lines');
  assert.ok(report.layers.length >= 4, 'Should categorize multiple architectural layers');
  assert.ok(report.largestFiles.length >= 3, 'Should identify largest files');

  const patternIds = new Set(report.patterns.map((p) => p.id));
  assert.equal(patternIds.has('feature_sliced_ui'), true);
  assert.equal(patternIds.has('modular_pack_plugin'), true);
  assert.equal(patternIds.has('isolated_agent_core'), true);
  assert.equal(patternIds.has('local_first_sqlite_repo'), true);

  assert.ok(report.polyglotPillars.length === 4);
  assert.ok(report.suggestions.length >= 2);
});
