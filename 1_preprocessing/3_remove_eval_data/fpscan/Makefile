# libfpscan.so (C++17, no dependencies besides the vendored dr_flac and pocketfft headers): make -j
CXX ?= g++
CXXFLAGS ?= -O3 -std=c++17 $(if $(filter aarch64,$(shell uname -m)),-mcpu=native,-march=native) -fPIC -fno-math-errno -Wall -pthread

libfpscan.so: $(wildcard src/*.cpp) src/fp.hpp
	$(CXX) $(CXXFLAGS) -shared -o $@ $(filter %.cpp,$^)

clean:
	rm -f libfpscan.so
