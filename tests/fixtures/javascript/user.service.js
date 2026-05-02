'use strict';

angular.module('app')
  .service('UserService', ['$http', '$q', function($http, $q) {
    this.getUser = function(id) {
      return $http.get('/api/users/' + id);
    };

    this.updateUser = function(id, data) {
      return $http.put('/api/users/' + id, data);
    };

    this.deleteUser = function(id) {
      return $http.delete('/api/users/' + id);
    };
  }]);
