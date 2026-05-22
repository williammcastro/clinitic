import AudioToolbox
import CoreAudio
import Foundation

func getPropertySize(
  _ objectID: AudioObjectID,
  _ selector: AudioObjectPropertySelector,
  _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
  _ element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
) -> UInt32? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: scope,
    mElement: element
  )
  var size: UInt32 = 0
  let status = AudioObjectGetPropertyDataSize(objectID, &address, 0, nil, &size)
  return status == noErr ? size : nil
}

func getString(
  _ objectID: AudioObjectID,
  _ selector: AudioObjectPropertySelector
) -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  let status = AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value)
  return status == noErr ? value as String : "(unavailable)"
}

func getDouble(
  _ objectID: AudioObjectID,
  _ selector: AudioObjectPropertySelector
) -> Double? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value = Float64(0)
  var size = UInt32(MemoryLayout<Float64>.size)
  let status = AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value)
  return status == noErr ? value : nil
}

func getAudioDeviceID(_ selector: AudioObjectPropertySelector) -> AudioDeviceID? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  let status = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &address,
    0,
    nil,
    &size,
    &value
  )
  return status == noErr ? value : nil
}

func streamConfiguration(
  _ objectID: AudioObjectID,
  scope: AudioObjectPropertyScope
) -> (channels: Int, buffers: Int) {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyStreamConfiguration,
    mScope: scope,
    mElement: kAudioObjectPropertyElementMain
  )
  guard let propertySize = getPropertySize(objectID, kAudioDevicePropertyStreamConfiguration, scope) else {
    return (0, 0)
  }

  let bufferListPointer = UnsafeMutableRawPointer.allocate(
    byteCount: Int(propertySize),
    alignment: MemoryLayout<AudioBufferList>.alignment
  )
  defer { bufferListPointer.deallocate() }

  var size = propertySize
  let status = AudioObjectGetPropertyData(
    objectID,
    &address,
    0,
    nil,
    &size,
    bufferListPointer
  )
  guard status == noErr else {
    return (0, 0)
  }

  let audioBufferList = bufferListPointer.bindMemory(to: AudioBufferList.self, capacity: 1)
  let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
  let channelCount = buffers.reduce(0) { total, buffer in
    total + Int(buffer.mNumberChannels)
  }

  return (channelCount, buffers.count)
}

var address = AudioObjectPropertyAddress(
  mSelector: kAudioHardwarePropertyDevices,
  mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain
)

var dataSize: UInt32 = 0
var status = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize)
guard status == noErr else {
  fatalError("Unable to read CoreAudio devices")
}

let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
var deviceIDs = Array(repeating: AudioDeviceID(), count: deviceCount)
status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize, &deviceIDs)
guard status == noErr else {
  fatalError("Unable to read CoreAudio device IDs")
}

print("CoreAudio devices: \(deviceIDs.count)")

let defaultInputDeviceID = getAudioDeviceID(kAudioHardwarePropertyDefaultInputDevice)
let defaultOutputDeviceID = getAudioDeviceID(kAudioHardwarePropertyDefaultOutputDevice)

for deviceID in deviceIDs {
  let input = streamConfiguration(deviceID, scope: kAudioDevicePropertyScopeInput)
  let output = streamConfiguration(deviceID, scope: kAudioDevicePropertyScopeOutput)
  let sampleRate = getDouble(deviceID, kAudioDevicePropertyNominalSampleRate)

  print("")
  print("id: \(deviceID)")
  print("default_input: \(deviceID == defaultInputDeviceID)")
  print("default_output: \(deviceID == defaultOutputDeviceID)")
  print("name: \(getString(deviceID, kAudioObjectPropertyName))")
  print("manufacturer: \(getString(deviceID, kAudioObjectPropertyManufacturer))")
  print("uid: \(getString(deviceID, kAudioDevicePropertyDeviceUID))")
  print("input_channels: \(input.channels)")
  print("input_buffers: \(input.buffers)")
  print("output_channels: \(output.channels)")
  print("output_buffers: \(output.buffers)")
  if let sampleRate {
    print("nominal_sample_rate: \(Int(sampleRate))")
  } else {
    print("nominal_sample_rate: unavailable")
  }
}
