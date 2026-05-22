import AVFoundation
import Foundation

let seconds = CommandLine.arguments.dropFirst().first.flatMap(Double.init) ?? 10
let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.inputFormat(forBus: 0)

print("default_input_channels: \(format.channelCount)")
print("sample_rate: \(Int(format.sampleRate))")
print("duration_seconds: \(Int(seconds))")
print("Speak into the microphone now.")

input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
  let channelCount = Int(buffer.format.channelCount)
  let frameLength = Int(buffer.frameLength)
  guard let channelData = buffer.floatChannelData, frameLength > 0 else {
    return
  }

  var parts: [String] = []
  for channel in 0..<channelCount {
    let samples = channelData[channel]
    var sum: Float = 0
    for index in 0..<frameLength {
      let value = samples[index]
      sum += value * value
    }
    let rms = sqrt(sum / Float(frameLength))
    let db = 20 * log10(max(rms, 0.000_001))
    parts.append("ch\(channel + 1): \(String(format: "%.1f", db)) dB")
  }

  print(parts.joined(separator: " | "))
}

do {
  try engine.start()
  Thread.sleep(forTimeInterval: seconds)
  engine.stop()
  input.removeTap(onBus: 0)
} catch {
  print("error: \(error.localizedDescription)")
  exit(1)
}
