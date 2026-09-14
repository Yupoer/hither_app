import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import type {NavigationSession} from '../types/navigation';
let mockChange!:(state:string)=>void;
let mockEvent!:(session:NavigationSession)=>void;
const mockRead=jest.fn(async ():Promise<NavigationSession|null>=>null);
const mockUnsubscribe=jest.fn();
const mockApp={currentState:'active',addEventListener:(_event:string,fn:(state:string)=>void)=>{mockChange=fn;return {remove:jest.fn()};}};
jest.mock('react-native',()=>({AppState:mockApp}));
jest.mock('expo-constants',()=>({expoConfig:{}}));
jest.mock('expo-updates',()=>({}));
jest.mock('../state/diagnostics',()=>({diagnostics:{write:jest.fn(async()=>{})}}));
jest.mock('../state/coreDataSync',()=>({enqueuePersonalNavigationResponse:jest.fn()}));
jest.mock('../api/services/_helpers',()=>({requireUserId:async()=> 'u'}));
jest.mock('../api/services/NavigationService',()=>({getActiveNavigationSession:()=>mockRead(),getMyNavigationMemberState:async()=>null,
 subscribeNavigationSession:async (_id:string,fn:(session:NavigationSession)=>void)=>{mockEvent=fn;return mockUnsubscribe;}}));
import {useNavigationSession} from '../state/useNavigationSession';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

test('old terminal and active events cannot replace a newer target; background unsubscribes and resume refreshes',async()=>{
 let hook!:ReturnType<typeof useNavigationSession>;
 function Probe(){hook=useNavigationSession('g');return null;}
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(Probe));});
 const a={id:'a',groupId:'g',destinationId:'one',startedAt:'2026-09-14T00:00:00Z',expiresAt:'2026-09-14T08:00:00Z',status:'active',version:1} as NavigationSession;
 const b={...a,id:'b',destinationId:'two',startedAt:'2026-09-14T00:01:00Z'};
 await act(async()=>mockEvent(a));
 await act(async()=>mockEvent(b));
 await act(async()=>mockEvent({...a,status:'cancelled',version:2}));
 expect(hook.session?.id).toBe('b');
 await act(async()=>mockEvent({...b,status:'completed',version:2}));
 await act(async()=>mockEvent(b));
 expect(hook.session).toBeNull();
 await act(async()=>{mockApp.currentState='background';mockChange('background');});
 expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
 const count=mockRead.mock.calls.length;
 await hook.refresh();
 expect(mockRead).toHaveBeenCalledTimes(count);
 mockRead.mockResolvedValueOnce({...b,id:'c',startedAt:'2026-09-14T00:02:00Z'});
 await act(async()=>{mockApp.currentState='active';mockChange('active');});
 expect(hook.session?.id).toBe('c');
 await act(async()=>tree.unmount());
});
