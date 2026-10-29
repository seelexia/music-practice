import test from 'node:test';
import assert from 'node:assert/strict';
import {gateFromNoise,monitorCoordinate} from './monitor';
test('idle listening advances by capture time while song view uses musical beat',()=>{assert.equal(monitorCoordinate({at:12.5,beat:0},true),12.5);assert.equal(monitorCoordinate({at:13,beat:0},true),13);assert.equal(monitorCoordinate({at:12.5,beat:8},false),8);});
test('noise presets use robust measured floor and distinct suppression thresholds',()=>{const medium=gateFromNoise([-63,-62,-61,-60,-12],'medium');assert.equal(medium.baseline,-61);assert.equal(medium.gateDb,-49);assert.ok(gateFromNoise([-61],'strong').gateDb>medium.gateDb);assert.equal(gateFromNoise([-61],'off').gateDb,-90);assert.throws(()=>gateFromNoise([],'medium'));});
