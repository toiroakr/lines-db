import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(currentDir, '..', 'package.json');
const changesetPath = join(currentDir, '..', '..', '.changeset', 'remove-valibot-peer-dep.md');

type PackageJson = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
}

describe('lib/package.json', () => {
  it('should be valid, parseable JSON', () => {
    expect(() => readPackageJson()).not.toThrow();
  });

  it('should not declare a peerDependencies field', () => {
    const pkg = readPackageJson();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('should not declare a peerDependenciesMeta field', () => {
    const pkg = readPackageJson();
    expect(pkg.peerDependenciesMeta).toBeUndefined();
  });

  it('should not require valibot at all (neither as a peer nor as a runtime dependency)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies?.valibot).toBeUndefined();
    expect(pkg.peerDependencies?.valibot).toBeUndefined();
  });

  it('should keep @standard-schema/spec as a runtime dependency, since it is the only schema interface relied upon at runtime', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies?.['@standard-schema/spec']).toBeDefined();
  });

  it('should keep amaro as a runtime dependency', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies?.amaro).toBeDefined();
  });

  it('should still keep valibot available as a devDependency for tests/fixtures', () => {
    const pkg = readPackageJson();
    expect(pkg.devDependencies?.valibot).toBeDefined();
  });

  it('should not have an empty object left behind for peerDependencies keys', () => {
    const pkg = readPackageJson();
    expect(Object.keys(pkg).includes('peerDependencies')).toBe(false);
    expect(Object.keys(pkg).includes('peerDependenciesMeta')).toBe(false);
  });
});

describe('.changeset/remove-valibot-peer-dep.md', () => {
  function readChangeset(): string {
    return readFileSync(changesetPath, 'utf-8');
  }

  it('should exist and be readable', () => {
    expect(() => readChangeset()).not.toThrow();
  });

  it('should declare a patch release for @toiroakr/lines-db in its frontmatter', () => {
    const content = readChangeset();
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).not.toBeNull();

    const frontmatter = frontmatterMatch?.[1] ?? '';
    expect(frontmatter).toContain("'@toiroakr/lines-db': patch");
  });

  it('should describe the removal of the valibot peerDependency in its body', () => {
    const content = readChangeset();
    const body = content.replace(/^---\n[\s\S]*?\n---/, '').trim();

    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/valibot/i);
    expect(body).toMatch(/peerDependency/i);
    expect(body).toMatch(/@standard-schema\/spec/);
  });
});