export const Accuracy = { High: 1, BestForNavigation: 2 };
export async function requestForegroundPermissionsAsync() { return { status: 'denied', granted: false, canAskAgain: true }; }
export const getForegroundPermissionsAsync = requestForegroundPermissionsAsync;
export async function getCurrentPositionAsync() { throw Error('Test harness has no device GPS'); }
export async function watchPositionAsync() { throw Error('Test harness has no device GPS'); }
