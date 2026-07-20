import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import {
  desktopIdentity,
  desktopUserDataPath,
  normalizeDevInstance,
  resolveDesktopChannel,
} from './desktop-runtime'

test('explicit valid desktop channel wins over packaging state', () => {
  assert.equal(resolveDesktopChannel('dev', true), 'dev')
  assert.equal(resolveDesktopChannel('release', false), 'release')
})

test('desktop channel defaults packaged builds to release and source builds to dev', () => {
  assert.equal(resolveDesktopChannel(undefined, true), 'release')
  assert.equal(resolveDesktopChannel('invalid', true), 'release')
  assert.equal(resolveDesktopChannel(undefined, false), 'dev')
})

test('dev identity and user data are isolated and instance names are filesystem safe', () => {
  assert.equal(normalizeDevInstance(' feature/foo '), 'feature-foo')
  const identity = desktopIdentity('dev', 'feature/foo')
  assert.equal(identity.appName, 'Tokmon Dev · feature-foo')
  assert.equal(desktopUserDataPath('/tmp/app-data', identity), path.join('/tmp/app-data', 'Tokmon Dev · feature-foo'))
  assert.equal(desktopIdentity('release', 'ignored').appName, 'Tokmon')
})
