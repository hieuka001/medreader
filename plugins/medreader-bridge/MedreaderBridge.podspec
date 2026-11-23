require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'MedreaderBridge'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://github.com/hieuka001/medreader'
  s.author = 'hieuka001'
  s.source = { :git => 'https://github.com/hieuka001/medreader', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.static_framework = true
  s.dependency 'Capacitor'
  s.frameworks = 'Vision', 'UIKit'
  s.swift_version = '5.1'
end
