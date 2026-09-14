const mockStore = new Map<string,string>();
const mockSetRemote = jest.fn(async (..._args: unknown[]) => {});
const mockGetRemote = jest.fn(async ():Promise<boolean|null> => true);
jest.mock('@react-native-async-storage/async-storage', () => ({
 getItem: jest.fn(async (key:string) => mockStore.get(key) ?? null),
 setItem: jest.fn(async (key:string,value:string) => {mockStore.set(key,value);}),
 removeItem: jest.fn(async (key:string) => {mockStore.delete(key);}),
}));
jest.mock('../api/services/NavigationService', () => ({
 setLocationSharingEnabled: (...args:unknown[])=>mockSetRemote(...args),
 getLocationSharingEnabled: ()=>mockGetRemote(),
}));
import { rememberLocationSharing, syncLocationSharing, hydrateLocationSharing } from '../state/locationSharingSync';
import { setLocationAccessContext, setLocationSharingConsent, captureLocationAccess, LOCATION_SHARING_KEY } from '../state/locationPrivacy';

test('offline stop stays off and retries only for its authenticated owner', async () => {
 setLocationAccessContext('g',true,true);
 setLocationSharingConsent(false);
 mockStore.set(LOCATION_SHARING_KEY,'false');
 await rememberLocationSharing('u',false);
 mockSetRemote.mockRejectedValueOnce(new Error('offline'));
 await expect(syncLocationSharing('u')).rejects.toThrow('offline');
 expect(await captureLocationAccess()).toBeNull();
 await syncLocationSharing('other');
 expect(mockSetRemote).toHaveBeenCalledTimes(1);
 await syncLocationSharing('u');
 expect(mockSetRemote).toHaveBeenLastCalledWith(false,'u');
 await syncLocationSharing('u');
 expect(mockSetRemote).toHaveBeenCalledTimes(2);
 expect(await hydrateLocationSharing('u')).toBe(false);
});

test('a late remote enabled snapshot cannot undo an in-flight local stop', async () => {
 mockStore.clear();
 setLocationAccessContext('g',true,true);
 let release!:(value:boolean)=>void;
 mockGetRemote.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const hydrate = hydrateLocationSharing('u');
 for(let i=0;i<20&&!release;i++) await Promise.resolve();
 expect(release).toBeDefined();
 setLocationSharingConsent(false);
 release(true);
 expect(await hydrate).toBeNull();
 expect(await captureLocationAccess()).toBeNull();
});
