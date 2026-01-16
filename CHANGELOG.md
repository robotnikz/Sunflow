## [1.11.1](https://github.com/robotnikz/Sunflow/compare/v1.11.0...v1.11.1) (2026-01-16)


### Bug Fixes

* constrain uploaded file paths ([146fe61](https://github.com/robotnikz/Sunflow/commit/146fe61d5267adcfe84c1598854d63e240c98e53))
* dedupe /api/energy overlaps ([db7cfbb](https://github.com/robotnikz/Sunflow/commit/db7cfbbd9098c6705d5456e9486171512cfb2095))
* dedupe /api/history overlaps ([8da489f](https://github.com/robotnikz/Sunflow/commit/8da489f24702bc0becbf05ef74987cc148811e33))
* **docker:** handle readonly DB permissions ([5151b54](https://github.com/robotnikz/Sunflow/commit/5151b54b066b2d3e7ab40239ff4222cf8e812da1))
* **docker:** make /app/data writable out-of-box ([19e17ff](https://github.com/robotnikz/Sunflow/commit/19e17fff32822b651fee9c75ffd06abb82dc4d7c))
* sanitize upload temp file paths ([9517666](https://github.com/robotnikz/Sunflow/commit/9517666de3f2421aaa08f2b29e41f99d985248fb))
* **ui:** close settings modal on Escape ([165f2ef](https://github.com/robotnikz/Sunflow/commit/165f2ef46cd3f8c4fe276e8af56bb45d514e0f6a))
* validate csv import mapping ([d889e7f](https://github.com/robotnikz/Sunflow/commit/d889e7f3469ea40816c7fe681766d0a8c00272bd))

# [1.11.0](https://github.com/robotnikz/Sunflow/compare/v1.10.1...v1.11.0) (2026-01-15)


### Features

* trigger 1.11.0 release ([b2531d1](https://github.com/robotnikz/Sunflow/commit/b2531d106fdb0e81e0b045a8ec70003fac59e62b))

## [1.10.1](https://github.com/robotnikz/Sunflow/compare/v1.10.0...v1.10.1) (2026-01-15)


### Bug Fixes

* **smart-usage:** respect reserve SOC in smart usage and notifications ([db3409d](https://github.com/robotnikz/Sunflow/commit/db3409dccc9a7248f525fd4f70ace32be7e6dba8))
* **smart-usage:** use real sunrise/sunset boundaries ([542ec5d](https://github.com/robotnikz/Sunflow/commit/542ec5d84ad77e19c5b9afa6477a3dd0eb2435ed))

# [1.10.0](https://github.com/robotnikz/Sunflow/compare/v1.9.3...v1.10.0) (2026-01-15)


### Bug Fixes

* **smart-recommendations:** show per-run cost and battery equivalent ([df77e51](https://github.com/robotnikz/Sunflow/commit/df77e513c4841bfb06d58dc567abab79b2223e70))


### Features

* **appliances:** allow kWh-per-run or watts+duration ([f361103](https://github.com/robotnikz/Sunflow/commit/f361103ca3441a42d4732eb748bfdc4dd5c94a9d))

## [1.9.3](https://github.com/robotnikz/Sunflow/compare/v1.9.2...v1.9.3) (2026-01-15)


### Bug Fixes

* **scenario-planner:** align baseline with measured flows ([0fa93f7](https://github.com/robotnikz/Sunflow/commit/0fa93f7923ee79b466b3ff17947aab471e816c04))
* **scenario-planner:** avoid misleading battery suggestion ([9372a23](https://github.com/robotnikz/Sunflow/commit/9372a231263864397bbec6d31b8f173e137c2390))

## [1.9.2](https://github.com/robotnikz/Sunflow/compare/v1.9.1...v1.9.2) (2026-01-15)


### Bug Fixes

* **scenario-planner:** account for PV/battery dependency ([11f25e6](https://github.com/robotnikz/Sunflow/commit/11f25e643468e3578977670a2a6c8151e0cae18d))

## [1.9.1](https://github.com/robotnikz/Sunflow/compare/v1.9.0...v1.9.1) (2026-01-13)


### Bug Fixes

* **ui:** simplify awattar compare inputs ([7e76f42](https://github.com/robotnikz/Sunflow/commit/7e76f42f9fc5b34ec75cea216ed2c069eef8b76c))

# [1.9.0](https://github.com/robotnikz/Sunflow/compare/v1.8.0...v1.9.0) (2026-01-13)


### Features

* **dashboard:** add aWATTar dynamic tariff comparison ([7a2f279](https://github.com/robotnikz/Sunflow/commit/7a2f27955aeeebd05a8b75e24c03fa001989b81c))

# [1.8.0](https://github.com/robotnikz/Sunflow/compare/v1.7.0...v1.8.0) (2026-01-13)


### Features

* **tariffs:** compare fixed vs aWATTar prices ([f9121f9](https://github.com/robotnikz/Sunflow/commit/f9121f954f570d4428bfda3c1d3f8c0af2fa6e65))

# [1.7.0](https://github.com/robotnikz/Sunflow/compare/v1.6.0...v1.7.0) (2026-01-12)


### Features

* **scenario-planner:** add timeframe selector and baseline autonomy ([93c20ad](https://github.com/robotnikz/Sunflow/commit/93c20ada4ab7f8f617386633326ebb3a28c71459))

# [1.6.0](https://github.com/robotnikz/Sunflow/compare/v1.5.0...v1.6.0) (2026-01-11)


### Bug Fixes

* **tests:** resolve typescript errors in test suite ([ffb5e89](https://github.com/robotnikz/Sunflow/commit/ffb5e89a5dd77d71b62aa9c69828d41f3b677c5f))


### Features

* **core:** enhance ROI accuracy, server performance and test coverage ([c19a480](https://github.com/robotnikz/Sunflow/commit/c19a480c43a5cc848a54b5953232d7f32274679c))

# [1.5.0](https://github.com/robotnikz/Sunflow/compare/v1.4.0...v1.5.0) (2026-01-11)


### Bug Fixes

* **settings:** import missing getConfig in SettingsModal ([35c14c6](https://github.com/robotnikz/Sunflow/commit/35c14c6287fdb632be2cca1b625a4373200d068c))


### Features

* enhance history visualization, csv imports, and ROI simulation accuracy ([61e2194](https://github.com/robotnikz/Sunflow/commit/61e21947b67206a529ec664c5cc1cdd0d87d7881))

# [1.4.0](https://github.com/robotnikz/Sunflow/compare/v1.3.6...v1.4.0) (2026-01-11)


### Features

* history graphs now show the current day, week, etc. Also added an option to go back in time on the graphs. ([857c5a4](https://github.com/robotnikz/Sunflow/commit/857c5a4082ed887b21fc485569dce74f1386d300))

## [1.3.6](https://github.com/robotnikz/Sunflow/compare/v1.3.5...v1.3.6) (2026-01-11)


### Bug Fixes

* trigger release ([42f48dd](https://github.com/robotnikz/Sunflow/commit/42f48dd916d4757e58f0aa39c5c31d2d4120e6a6))

## [1.3.5](https://github.com/robotnikz/Sunflow/compare/v1.3.4...v1.3.5) (2026-01-10)


### Bug Fixes

* added possible to enter mixed tariffs with different earnings. e.g up to 10kw and >10kw ([20ae93b](https://github.com/robotnikz/Sunflow/commit/20ae93baa74ff06d9cfea8ac471704adbc4fb8ea))
* latest commit ([dffad23](https://github.com/robotnikz/Sunflow/commit/dffad233a53fe9addb005e33e2ab250cbe638720))

## [1.3.4](https://github.com/robotnikz/Sunflow/compare/v1.3.3...v1.3.4) (2026-01-09)


### Bug Fixes

* battery widget charging animation changed from radar animation to a slight pulse ([7efcee1](https://github.com/robotnikz/Sunflow/commit/7efcee186cc3fe23e32dbed59a4cc950338debb3))

## [1.3.3](https://github.com/robotnikz/Sunflow/compare/v1.3.2...v1.3.3) (2026-01-09)


### Bug Fixes

* changed Dockerfile to Debian:slim ([60f87e3](https://github.com/robotnikz/Sunflow/commit/60f87e3f0759c0851935831483576da7f225ec01))

## [1.3.2](https://github.com/robotnikz/Sunflow/compare/v1.3.1...v1.3.2) (2026-01-09)


### Bug Fixes

* smart recommendation backend logic fixed for notifications ([77614f1](https://github.com/robotnikz/Sunflow/commit/77614f17721c5ebfd28d5b389a5a9250374332e5))

## [1.3.1](https://github.com/robotnikz/Sunflow/compare/v1.3.0...v1.3.1) (2026-01-09)


### Bug Fixes

* **tests:** Resolve test suite failures and warnings ([7cb00c1](https://github.com/robotnikz/Sunflow/commit/7cb00c12ea06bdaa276914b58bdc399c9300565e))

# [1.3.0](https://github.com/robotnikz/Sunflow/compare/v1.2.1...v1.3.0) (2026-01-09)


### Features

* added Battery Health widget and also notification option for Battery Health. You can define a threshold and amount of cycles before notified when battery health is low ([a95e40b](https://github.com/robotnikz/Sunflow/commit/a95e40b7131af2395b34573ac2f0709f2b350d76))

## [1.2.1](https://github.com/robotnikz/Sunflow/compare/v1.2.0...v1.2.1) (2026-01-09)


### Bug Fixes

* refactoring ([81e5ff9](https://github.com/robotnikz/Sunflow/commit/81e5ff9444cb60ecf8d4ffebe07df1f5b6e50abb))

# [1.2.0](https://github.com/robotnikz/Sunflow/compare/v1.1.0...v1.2.0) (2026-01-09)


### Bug Fixes

* fixed blurry fonts in history graphs ([a641396](https://github.com/robotnikz/Sunflow/commit/a641396b0ff694ea1e9fc0434690a004c757b1ec))
* fixed forecast logic. ([f76399a](https://github.com/robotnikz/Sunflow/commit/f76399ab5e50d0d2cd2f70bd4b1ab14839088a00))
* fixed some optical glitches in settings panel ([6714a8b](https://github.com/robotnikz/Sunflow/commit/6714a8b27dfa33bf9c9ba4a98856f0992b3f1e46))
* fixed some widget bugs ([78bc499](https://github.com/robotnikz/Sunflow/commit/78bc499546b95180bb1ac0c0c142c94e804340d2))


### Features

* added option for discord notifications ([7d1cabd](https://github.com/robotnikz/Sunflow/commit/7d1cabd279c4dfbaf860dd50769e40dfad6770f3))

# [1.1.0](https://github.com/robotnikz/Sunflow/compare/v1.0.3...v1.1.0) (2026-01-09)


### Bug Fixes

* added SOC charging to power history ([b023096](https://github.com/robotnikz/Sunflow/commit/b023096879c53aab9f23d4db5d659f6c91efc9b8))
* battery charging/discharging in live power view ([d45106e](https://github.com/robotnikz/Sunflow/commit/d45106ed2a6b8704a95dc88a243c17ca7f745324))
* fixed energy donuts visuals ([7f1ab17](https://github.com/robotnikz/Sunflow/commit/7f1ab17df6dbe4b1f0f80fd1f12fe4be189a6003))
* improved break even calculation, added invested to date and estimated total cost at break even ([711d8c4](https://github.com/robotnikz/Sunflow/commit/711d8c44747fcc509c078ccb5fa6c65142339db0))
* improved smart use logic, fallback to open-meteo for pv forecast in case solcast settings are missing or api limit reached. ([e8e232b](https://github.com/robotnikz/Sunflow/commit/e8e232b479f5eb7c3de70ebf1fafbe60d537f7e8))


### Features

* added option to export data as .csv ([ab9dc4b](https://github.com/robotnikz/Sunflow/commit/ab9dc4bf195a763f001d9342c55dee60b7e2b3f6))
* added smart usage predictions, battery min 30% + rough >1h forecast to determine best usage time for your devices (testing stage) ([3e298fa](https://github.com/robotnikz/Sunflow/commit/3e298fa6c02c4f5675888cb37cadb046bba4a11f))
* added solcast API in settings for forecast used in smart predictions ([de44743](https://github.com/robotnikz/Sunflow/commit/de44743f011d12351ba56afb6c9dbb5dc1cb4e58))

## [1.0.3](https://github.com/robotnikz/Sunflow/compare/v1.0.2...v1.0.3) (2026-01-08)


### Bug Fixes

* delete buttons not working in settings ([c9887bf](https://github.com/robotnikz/Sunflow/commit/c9887bfd5dc1665f243dabf343472130b52ffc7b))

## [1.0.2](https://github.com/robotnikz/Sunflow/compare/v1.0.1...v1.0.2) (2026-01-08)


### Bug Fixes

* fixed bugged hindering container to start ([5cdb37e](https://github.com/robotnikz/Sunflow/commit/5cdb37e1b7ca6790e8ed9ab827ae5e024b665e1e))

## [1.0.1](https://github.com/robotnikz/Sunflow/compare/v1.0.0...v1.0.1) (2026-01-08)


### Bug Fixes

* fixed a bug where tarrifs could not be deleted ([e9451ca](https://github.com/robotnikz/Sunflow/commit/e9451ca4689b83611e692118a8f74a1df727cee6))

# 1.0.0 (2026-01-08)


### Bug Fixes

* Adjust chart margins and spacing for better readability ([d92df61](https://github.com/robotnikz/Sunflow/commit/d92df6171dc68c1f1378396820799198fa1d7586))
* **dashboard:** Adjust layout for better power flow display ([d55dbe9](https://github.com/robotnikz/Sunflow/commit/d55dbe9b87224dd8b5a1f50b003ad9fb05fc16e5))
* **db:** Improve migration for status_code column ([72d2aff](https://github.com/robotnikz/Sunflow/commit/72d2affbf80ea4630b7c2391636210946deaf151))
* docker ([1870bd2](https://github.com/robotnikz/Sunflow/commit/1870bd2b9544edae4e94137c666e7d74bf08d60e))
* docker build ([42399b3](https://github.com/robotnikz/Sunflow/commit/42399b33d9f7032f1eee283540a3560ed2c2f7cc))
* Dockerfile ([45d77ed](https://github.com/robotnikz/Sunflow/commit/45d77ed33d8406e1f29b763df25a8c295f557d7e))
* Improve financial forecast calculation ([4793231](https://github.com/robotnikz/Sunflow/commit/4793231eab2427dfa1178704f65f8b414885794e))
* **settings:** Improve financial return input styling ([13a61bd](https://github.com/robotnikz/Sunflow/commit/13a61bdf8e42de151eee19ce594f84412abeaaeb))
* **SettingsModal:** Improve financial return input styling ([958fc84](https://github.com/robotnikz/Sunflow/commit/958fc84e2e71cfd6f8191ffd4dd128349d51604e))


### Features

* Add battery and efficiency charts ([3de494f](https://github.com/robotnikz/Sunflow/commit/3de494f4ba0f3a251288826cecb9240c4d604bed))
* Add custom date range for history ([1dd3e1f](https://github.com/robotnikz/Sunflow/commit/1dd3e1fedd5bbbdfed2141576ededbdb5e1c360e))
* Add degradation and inflation rates to config ([2f41c84](https://github.com/robotnikz/Sunflow/commit/2f41c848c2707a521673c62d6dd1758a7693d7d5))
* Add hourly time range and database index ([818aa92](https://github.com/robotnikz/Sunflow/commit/818aa921aa0f5a9eb23bf6ec643021da58fd79d8))
* Add initial values for historical data ([9991261](https://github.com/robotnikz/Sunflow/commit/99912610246e4d767e97eb2c66230ccbad5f9a85))
* Add inverter status to history and display timeline ([614c38c](https://github.com/robotnikz/Sunflow/commit/614c38ccfc78a72eb0802d2bd8127feb49c7a7f1))
* Add local timestamps and animations ([e4579af](https://github.com/robotnikz/Sunflow/commit/e4579afaa3b98b14de5740b32d8e63423736d63b))
* Add location and weather support ([cda3a0c](https://github.com/robotnikz/Sunflow/commit/cda3a0cc7772af1654641c4f9c28c9b6a1f63ad2))
* Add real-time autonomy and self-consumption metrics ([74c59f5](https://github.com/robotnikz/Sunflow/commit/74c59f5987327696af4f47fc4fd1c34f3e974b41))
* Add system info and update checks ([fdcfd66](https://github.com/robotnikz/Sunflow/commit/fdcfd6617af0614f74389e125e135609ae4f995f))
* Adjust component heights for better layout ([8927897](https://github.com/robotnikz/Sunflow/commit/89278979d91998260d522f59026aa9afa265fc7e))
* **AmortizationWidget:** Improve break-even estimation ([cf9c5cc](https://github.com/robotnikz/Sunflow/commit/cf9c5cc67f75732d00f7d6fb45ce41bc0279984c))
* Auto-refresh ROI data every minute ([7b5d1f8](https://github.com/robotnikz/Sunflow/commit/7b5d1f898d5ff783dd96828fb3054ace9e8e6edb))
* Configure persistent data directory ([c6f467f](https://github.com/robotnikz/Sunflow/commit/c6f467f389c82b72fa8f6afa44fe5791d5ef1094))
* Configure Vite for development server proxy ([16177d3](https://github.com/robotnikz/Sunflow/commit/16177d385b4b0d7365ac711d7171d2e04c9d99ac))
* **dashboard:** Enhance stats and add CO2 calculation ([853ecb1](https://github.com/robotnikz/Sunflow/commit/853ecb1865c0eceee4c08b4d4161b8d711280cfe))
* Display grid power flow in UI and data ([115ba07](https://github.com/robotnikz/Sunflow/commit/115ba07de4abca3437dd855fa82697a95d87104c))
* Enhance financial calculations and UI ([1c1adb9](https://github.com/robotnikz/Sunflow/commit/1c1adb9b29d9a3deb5b7852d123610c26e42008b))
* Enhance UI with custom font and layout adjustments ([e8c6ee9](https://github.com/robotnikz/Sunflow/commit/e8c6ee9d3011052a9d0ee4ccbca846bf06a66ab9))
* Implement expense tracking for ROI calculation ([8e324c8](https://github.com/robotnikz/Sunflow/commit/8e324c8547870bb8a7e4b02aa893ae449267f19b))
* Implement real-time energy history and stats ([625efb6](https://github.com/robotnikz/Sunflow/commit/625efb6a71d1eb06e3a9edb1601f0a2e3291ddf8))
* Improve dashboard layout and chart aesthetics ([fcbb919](https://github.com/robotnikz/Sunflow/commit/fcbb919ee6f971e16816c5b2f1e365e22779020c))
* Improve dashboard layout and sectioning ([c4f07eb](https://github.com/robotnikz/Sunflow/commit/c4f07eb356018d1514503ffce3b6fce039bd4ac8))
* Improve Docker build and UI elements ([02f7929](https://github.com/robotnikz/Sunflow/commit/02f79295e71a3fee410aaea1b600a8fe96ab6c00))
* Improve energy data aggregation ([235faad](https://github.com/robotnikz/Sunflow/commit/235faadc4a9c283481aab37c7d57ba107dc8a019))
* Improve number input styling in settings ([3a1ef64](https://github.com/robotnikz/Sunflow/commit/3a1ef64adc89a7dca94b220d1ae24d87a7c3aff5))
* Improve UI element spacing and layout ([3f6f425](https://github.com/robotnikz/Sunflow/commit/3f6f425b086d5883f88d9efcfd484a2d57b2a9a0))
* Improve widget text styling ([d971060](https://github.com/robotnikz/Sunflow/commit/d971060aa5eb5f10cedd8989aeb2add8dd94bea5))
* Initialize SolarSense Dashboard project ([5961265](https://github.com/robotnikz/Sunflow/commit/596126547dd786a53a19e46027c562f0237afef8))
* Introduce dashboard refresh mechanism ([c469464](https://github.com/robotnikz/Sunflow/commit/c469464403396e9bcddfad4ed743c9dded5302ce))
* Introduce dynamic tariff management ([19fbc30](https://github.com/robotnikz/Sunflow/commit/19fbc30435441a1ee9a700591b327a269b1202f0))
* Introduce visual BatteryWidget ([de9f0d1](https://github.com/robotnikz/Sunflow/commit/de9f0d1c130fd97c02a9f48e7938d0d28eaa305e))
* Migrate backend to ES Modules and add dependencies ([be88ab0](https://github.com/robotnikz/Sunflow/commit/be88ab0336151ebe36a2111165b4cc729292a921))
* **powerflow:** Improve visual flow and layout ([942c19d](https://github.com/robotnikz/Sunflow/commit/942c19da0ddbfe675005ec95ee75edfa659881de))
* Refactor PowerFlow component layout ([d8deb6c](https://github.com/robotnikz/Sunflow/commit/d8deb6c2c4b202480f674973189d08c3659d5d2c))
* **server:** Calculate yearly recurring costs ([09bb6a4](https://github.com/robotnikz/Sunflow/commit/09bb6a448fb59c6afa37dab77514245a001f64bf))
* **settings:** Add calibration tab and improve UI ([dc276d2](https://github.com/robotnikz/Sunflow/commit/dc276d28f4e4f84c98845137fdc0da98a5c5fa01))
* **settings:** Improve historical data input guidance ([b6ab194](https://github.com/robotnikz/Sunflow/commit/b6ab19454f2807fe9cbe9e537be22334ea214626))
* **StatusTimeline:** Simplify component logic and props ([b19aa13](https://github.com/robotnikz/Sunflow/commit/b19aa13a1d56823ddc08186ae44ce427e90bfd18))
* Update module imports and Vite proxy configuration ([73284f3](https://github.com/robotnikz/Sunflow/commit/73284f3f4aff876c57e57bb1181c1894d2412482))

# 1.0.0 (2026-01-08)


### Bug Fixes

* Adjust chart margins and spacing for better readability ([d92df61](https://github.com/robotnikz/Sunflow/commit/d92df6171dc68c1f1378396820799198fa1d7586))
* **dashboard:** Adjust layout for better power flow display ([d55dbe9](https://github.com/robotnikz/Sunflow/commit/d55dbe9b87224dd8b5a1f50b003ad9fb05fc16e5))
* **db:** Improve migration for status_code column ([72d2aff](https://github.com/robotnikz/Sunflow/commit/72d2affbf80ea4630b7c2391636210946deaf151))
* docker ([1870bd2](https://github.com/robotnikz/Sunflow/commit/1870bd2b9544edae4e94137c666e7d74bf08d60e))
* docker build ([42399b3](https://github.com/robotnikz/Sunflow/commit/42399b33d9f7032f1eee283540a3560ed2c2f7cc))
* Improve financial forecast calculation ([4793231](https://github.com/robotnikz/Sunflow/commit/4793231eab2427dfa1178704f65f8b414885794e))
* **settings:** Improve financial return input styling ([13a61bd](https://github.com/robotnikz/Sunflow/commit/13a61bdf8e42de151eee19ce594f84412abeaaeb))
* **SettingsModal:** Improve financial return input styling ([958fc84](https://github.com/robotnikz/Sunflow/commit/958fc84e2e71cfd6f8191ffd4dd128349d51604e))


### Features

* Add battery and efficiency charts ([3de494f](https://github.com/robotnikz/Sunflow/commit/3de494f4ba0f3a251288826cecb9240c4d604bed))
* Add custom date range for history ([1dd3e1f](https://github.com/robotnikz/Sunflow/commit/1dd3e1fedd5bbbdfed2141576ededbdb5e1c360e))
* Add degradation and inflation rates to config ([2f41c84](https://github.com/robotnikz/Sunflow/commit/2f41c848c2707a521673c62d6dd1758a7693d7d5))
* Add hourly time range and database index ([818aa92](https://github.com/robotnikz/Sunflow/commit/818aa921aa0f5a9eb23bf6ec643021da58fd79d8))
* Add initial values for historical data ([9991261](https://github.com/robotnikz/Sunflow/commit/99912610246e4d767e97eb2c66230ccbad5f9a85))
* Add inverter status to history and display timeline ([614c38c](https://github.com/robotnikz/Sunflow/commit/614c38ccfc78a72eb0802d2bd8127feb49c7a7f1))
* Add local timestamps and animations ([e4579af](https://github.com/robotnikz/Sunflow/commit/e4579afaa3b98b14de5740b32d8e63423736d63b))
* Add location and weather support ([cda3a0c](https://github.com/robotnikz/Sunflow/commit/cda3a0cc7772af1654641c4f9c28c9b6a1f63ad2))
* Add real-time autonomy and self-consumption metrics ([74c59f5](https://github.com/robotnikz/Sunflow/commit/74c59f5987327696af4f47fc4fd1c34f3e974b41))
* Add system info and update checks ([fdcfd66](https://github.com/robotnikz/Sunflow/commit/fdcfd6617af0614f74389e125e135609ae4f995f))
* Adjust component heights for better layout ([8927897](https://github.com/robotnikz/Sunflow/commit/89278979d91998260d522f59026aa9afa265fc7e))
* **AmortizationWidget:** Improve break-even estimation ([cf9c5cc](https://github.com/robotnikz/Sunflow/commit/cf9c5cc67f75732d00f7d6fb45ce41bc0279984c))
* Auto-refresh ROI data every minute ([7b5d1f8](https://github.com/robotnikz/Sunflow/commit/7b5d1f898d5ff783dd96828fb3054ace9e8e6edb))
* Configure persistent data directory ([c6f467f](https://github.com/robotnikz/Sunflow/commit/c6f467f389c82b72fa8f6afa44fe5791d5ef1094))
* Configure Vite for development server proxy ([16177d3](https://github.com/robotnikz/Sunflow/commit/16177d385b4b0d7365ac711d7171d2e04c9d99ac))
* **dashboard:** Enhance stats and add CO2 calculation ([853ecb1](https://github.com/robotnikz/Sunflow/commit/853ecb1865c0eceee4c08b4d4161b8d711280cfe))
* Display grid power flow in UI and data ([115ba07](https://github.com/robotnikz/Sunflow/commit/115ba07de4abca3437dd855fa82697a95d87104c))
* Enhance financial calculations and UI ([1c1adb9](https://github.com/robotnikz/Sunflow/commit/1c1adb9b29d9a3deb5b7852d123610c26e42008b))
* Enhance UI with custom font and layout adjustments ([e8c6ee9](https://github.com/robotnikz/Sunflow/commit/e8c6ee9d3011052a9d0ee4ccbca846bf06a66ab9))
* Implement expense tracking for ROI calculation ([8e324c8](https://github.com/robotnikz/Sunflow/commit/8e324c8547870bb8a7e4b02aa893ae449267f19b))
* Implement real-time energy history and stats ([625efb6](https://github.com/robotnikz/Sunflow/commit/625efb6a71d1eb06e3a9edb1601f0a2e3291ddf8))
* Improve dashboard layout and chart aesthetics ([fcbb919](https://github.com/robotnikz/Sunflow/commit/fcbb919ee6f971e16816c5b2f1e365e22779020c))
* Improve dashboard layout and sectioning ([c4f07eb](https://github.com/robotnikz/Sunflow/commit/c4f07eb356018d1514503ffce3b6fce039bd4ac8))
* Improve Docker build and UI elements ([02f7929](https://github.com/robotnikz/Sunflow/commit/02f79295e71a3fee410aaea1b600a8fe96ab6c00))
* Improve energy data aggregation ([235faad](https://github.com/robotnikz/Sunflow/commit/235faadc4a9c283481aab37c7d57ba107dc8a019))
* Improve number input styling in settings ([3a1ef64](https://github.com/robotnikz/Sunflow/commit/3a1ef64adc89a7dca94b220d1ae24d87a7c3aff5))
* Improve UI element spacing and layout ([3f6f425](https://github.com/robotnikz/Sunflow/commit/3f6f425b086d5883f88d9efcfd484a2d57b2a9a0))
* Improve widget text styling ([d971060](https://github.com/robotnikz/Sunflow/commit/d971060aa5eb5f10cedd8989aeb2add8dd94bea5))
* Initialize SolarSense Dashboard project ([5961265](https://github.com/robotnikz/Sunflow/commit/596126547dd786a53a19e46027c562f0237afef8))
* Introduce dashboard refresh mechanism ([c469464](https://github.com/robotnikz/Sunflow/commit/c469464403396e9bcddfad4ed743c9dded5302ce))
* Introduce dynamic tariff management ([19fbc30](https://github.com/robotnikz/Sunflow/commit/19fbc30435441a1ee9a700591b327a269b1202f0))
* Introduce visual BatteryWidget ([de9f0d1](https://github.com/robotnikz/Sunflow/commit/de9f0d1c130fd97c02a9f48e7938d0d28eaa305e))
* Migrate backend to ES Modules and add dependencies ([be88ab0](https://github.com/robotnikz/Sunflow/commit/be88ab0336151ebe36a2111165b4cc729292a921))
* **powerflow:** Improve visual flow and layout ([942c19d](https://github.com/robotnikz/Sunflow/commit/942c19da0ddbfe675005ec95ee75edfa659881de))
* Refactor PowerFlow component layout ([d8deb6c](https://github.com/robotnikz/Sunflow/commit/d8deb6c2c4b202480f674973189d08c3659d5d2c))
* **server:** Calculate yearly recurring costs ([09bb6a4](https://github.com/robotnikz/Sunflow/commit/09bb6a448fb59c6afa37dab77514245a001f64bf))
* **settings:** Add calibration tab and improve UI ([dc276d2](https://github.com/robotnikz/Sunflow/commit/dc276d28f4e4f84c98845137fdc0da98a5c5fa01))
* **settings:** Improve historical data input guidance ([b6ab194](https://github.com/robotnikz/Sunflow/commit/b6ab19454f2807fe9cbe9e537be22334ea214626))
* **StatusTimeline:** Simplify component logic and props ([b19aa13](https://github.com/robotnikz/Sunflow/commit/b19aa13a1d56823ddc08186ae44ce427e90bfd18))
* Update module imports and Vite proxy configuration ([73284f3](https://github.com/robotnikz/Sunflow/commit/73284f3f4aff876c57e57bb1181c1894d2412482))
