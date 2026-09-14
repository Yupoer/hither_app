jest.mock('../native/backgroundLocation',()=>({nextBackgroundLocation:jest.fn(async()=>null)}));
const mockWatch = jest.fn();
const mockPermission = jest.fn(async () => ({status:'granted'}));
jest.mock('expo-location',()=>({Accuracy:{High:4,Low:2,Balanced:3},
 requestForegroundPermissionsAsync:()=>mockPermission(),getForegroundPermissionsAsync:()=>mockPermission(),watchPositionAsync:(...args:unknown[])=>mockWatch(...args)}));
jest.mock('react-native',()=>({AppState:{currentState:'active'}}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:async()=>null}));
jest.mock('../native/debugLocation',()=>({isDebugRouteActive:()=>false,getDebugLocationSample:()=>null,subscribeDebugLocation:()=>()=>{}}));
import { getCurrentLocation } from '../native/location';
import { setLocationAccessContext,setLocationSharingConsent } from '../state/locationPrivacy';

test('stop sharing cancels a one-shot including a subscription that resolves late',async()=>{
 setLocationAccessContext('g',true,true);
 const remove=jest.fn();
 let attach!:(value:{remove:()=>void})=>void;
 let sample!:(value:unknown)=>void;
 mockWatch.mockImplementationOnce((_opts,callback)=>{sample=callback;return new Promise(resolve=>{attach=resolve;});});
 const reading=getCurrentLocation();
 for(let i=0;i<20&&!attach;i++)await Promise.resolve();
 expect(attach).toBeDefined();
 setLocationSharingConsent(false);
 expect(await reading).toBeNull();
 attach({remove});
 sample({coords:{latitude:25,longitude:121,accuracy:5},timestamp:Date.now()});
 await Promise.resolve();
 expect(remove).toHaveBeenCalledTimes(1);
 expect(await getCurrentLocation()).toBeNull();
 expect(mockWatch).toHaveBeenCalledTimes(1);
});
