from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_all

datas, binaries, hiddenimports = collect_all('cv2')
datas += collect_data_files('cv2', include_py_files=True)
